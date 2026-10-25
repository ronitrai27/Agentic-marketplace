/**
 * Stage 2 — Query formulator + multi-source fan-out + re-ranker.
 * Every source degrades independently (F9); ranking is a local blend (ARCHITECTURE §5).
 */
import { config } from '../config.js';
import { connectorStatuses, dedupe, fanOut, rankCandidates, type RankedCandidate, type SourceStatus } from '../connectors/index.js';
import type { SearchQuery } from '../connectors/types.js';
import { LlmQueriesSchema } from '../llm/chain.js';
import { sha256 } from '../lib/util.js';
import { embedTexts } from '../embed/embed.js';
import { loadClaims, loadReferences, rankReferences, saveReferences, upsertEmbeddings } from '../store/db.js';
import { topTerms, delay } from '../lib/util.js';
import { T, trackedChat, type RunContext } from './types.js';

export type RetrieveMode = 'primary' | 'broad';

export async function retrieveStep(ctx: RunContext, mode: RetrieveMode = 'primary'): Promise<void> {
  const cfg = config();

  if (mode === 'primary') {
    await ctx.stage('retrieving', 'retrieve');
    ctx.statuses = connectorStatuses();
  }

  const { claims, elements } = await loadClaims(ctx.analysis.id);
  if (!claims.length) throw new Error('retrieve: no claims to search against');
  const claimTexts = claims.map((c) => c.text);
  const claimCorpus = claimTexts.join('\n');

  const queries = await buildQueries(ctx, claimCorpus, mode);

  if (mode === 'primary') {
    await ctx.say({
      from: 'scout',
      to: 'clerk',
      template: T.queryPlan,
      payload: { queries: queries.map((q) => q.phrase), mode },
    });
  }

  const merged: RankedCandidate[] = [...ctx.candidates];
  let rawCount = 0;
  for (const q of queries) {
    const res = await fanOut(q);
    rawCount += res.candidates.length;
    merged.push(...(res.candidates as unknown as RankedCandidate[]));
    ctx.candidates = dedupe(merged as never) as RankedCandidate[];
    for (const st of res.statuses) {
      const existing = ctx.statuses.find((s) => s.source === st.source);
      if (existing) {
        existing.count += st.count;
        if (st.state === 'error' && existing.state !== 'error') {
          existing.state = 'error';
          existing.reason = st.reason;
        }
      } else ctx.statuses.push(st);
    }
    for (const c of res.candidates) {
      ctx.connectorCalls[c.source] = (ctx.connectorCalls[c.source] ?? 0) + 1;
      ctx.emit({
        type: 'candidate_found',
        publication_number: c.publicationNumber,
        office: c.office,
        kind: c.kind,
        title: c.title ?? '',
        count: ctx.candidates.length,
      });
    }
    await delay(400); // gentle pacing across query loops (free-tier friendly)
  }

  const ranked = await rankCandidates(ctx.candidates, claimTexts, { max: cfg.MAX_CANDIDATES });
  ctx.candidates = ranked;

  // Persist + rank (selected = top cross-referenced set)
  const newOnes = ranked.filter((r) => !ctx.refs.some((ref) => sameRef(ref, r)));
  await saveReferences(
    ctx.analysis.id,
    newOnes.map((r) => ({
      publicationNumber: r.publicationNumber,
      familyId: r.familyId,
      kind: r.kind,
      office: r.office,
      title: r.title,
      assignee: r.assignee,
      cpc: r.cpc,
      priorityDate: r.priorityDate,
      publicationDate: r.publicationDate,
      url: r.url,
      snippet: r.snippet,
      source: r.source,
    })),
  );

  // Re-rank ALL refs (old + new) so selection is stable across passes
  const allRows = await loadReferences(ctx.analysis.id);
  const byKey = new Map<string, (typeof allRows)[number]>();
  for (const row of allRows) byKey.set(pubKey(row.publication_number, row.url), row);

  const rankedRows: { id: number; score: number; breakdown: Record<string, number>; selected: boolean }[] = [];
  let position = 0;
  for (const r of ranked) {
    const row = byKey.get(pubKey(r.publicationNumber, r.url));
    if (!row) continue;
    position++;
    rankedRows.push({
      id: row.id,
      score: r.rank,
      breakdown: r.breakdown as unknown as Record<string, number>,
      selected: position <= cfg.MAX_CROSS_REFERENCED,
    });
  }
  await rankReferences(ctx.analysis.id, rankedRows);
  ctx.refs = allRows.filter((r) =>
    rankedRows.some((rr) => rr.id === r.id && rr.selected),
  );

  // Embed selected reference snippets → grounding for follow-up chat
  try {
    const selected = rankedRows.filter((r) => r.selected);
    const rowsForEmbed = selected
      .map((r) => allRows.find((a) => a.id === r.id))
      .filter((r): r is (typeof allRows)[number] => Boolean(r))
      .slice(0, cfg.MAX_CROSS_REFERENCED);
    if (rowsForEmbed.length) {
      const vecs = await embedTexts(rowsForEmbed.map((r) => r.snippet?.slice(0, 4000) ?? r.title ?? ''));
      await upsertEmbeddings(
        `analysis:${ctx.analysis.id}`,
        'reference',
        rowsForEmbed.map((r, i) => ({
          refKey: r.publication_number ?? r.url,
          content: [r.publication_number ?? '', r.title ?? '', r.snippet ?? ''].filter(Boolean).join('\n').slice(0, 4000),
          contentHash: sha256(`${r.url}:${r.snippet ?? ''}`),
          vector: vecs[i] ?? vecs[0]!,
        })),
      );
    }
  } catch {
    /* enhancement only */
  }

  if (mode === 'primary') {
    const ok = ctx.statuses.filter((s) => s.state === 'ok').length;
    const skipped = ctx.statuses.filter((s) => s.state === 'skipped').length;
    const errored = ctx.statuses.filter((s) => s.state === 'error').length;
    await ctx.say({
      from: 'scout',
      to: 'ari',
      template: T.sourcesReport,
      payload: { ok, skipped, errored, total: ctx.candidates.length, sources: ctx.statuses },
    });
    await ctx.say({
      from: 'clerk',
      to: 'examiner',
      template: T.familyMerge,
      payload: { merged: ctx.candidates.length, saved: allRows.length, deduped: Math.max(0, rawCount - ctx.candidates.length) },
    });
    await ctx.say({
      from: 'examiner',
      to: 'cartographer',
      template: T.searchResults,
      payload: { candidates: allRows.length, crossReferenced: ctx.refs.length },
    });
    ctx.progress('prior art retrieved', 2, 4);
  }
}

const sameRef = (row: { publication_number: string | null; url: string }, cand: { publicationNumber?: string; url: string }): boolean =>
  pubKey(row.publication_number, row.url) === pubKey(cand.publicationNumber, cand.url);

const pubKey = (pubnum?: string | null, url?: string | null): string =>
  (pubnum ?? url ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

async function buildQueries(
  ctx: RunContext,
  corpus: string,
  mode: RetrieveMode,
): Promise<SearchQuery[]> {
  const cfg = config();
  const max = Math.max(5, Math.ceil(cfg.MAX_CANDIDATES / 3));

  if (mode === 'broad') {
    // Widening: individual high-signal terms — maximise recall for the refinement pass
    const terms = topTerms(corpus, 10);
    return terms.slice(0, 4).map((t, i) => ({
      terms: [t],
      phrase: t,
      max,
      queryIndex: i,
    }));
  }

  const heuristicTerms = topTerms(corpus, 6);
  const queries: SearchQuery[] = [
    { terms: heuristicTerms, phrase: heuristicTerms.join(' '), max, queryIndex: 0 },
    { terms: heuristicTerms.slice(0, 3), phrase: heuristicTerms.slice(0, 3).join(' '), max, queryIndex: 1 },
  ];

  const llmQ = await trackedChat(ctx, {
    system:
      'You formulate patent prior-art search queries for the Indian Patent Office (IPO/CGPDTM). ' +
      'Return 1-2 concise keyword queries (no operators) and a best-guess IPC/CPC class ' +
      '(e.g. G06N, H04L, A61K) for the invention described. Prioritise terminology commonly ' +
      'used in Indian patent filings. Jurisdiction: India.',
    user: corpus.slice(0, 4000),
    schema: LlmQueriesSchema,
  });
  if (llmQ?.queries?.length) {
    llmQ.queries.slice(0, 2).forEach((phrase, i) => {
      queries.push({
        terms: phrase.split(/\s+/).slice(0, 6),
        phrase,
        cpc: llmQ.cpcGuess || undefined,
        max,
        queryIndex: queries.length + i,
      });
    });
    if (llmQ.cpcGuess) {
      queries[1] = { ...queries[1]!, cpc: llmQ.cpcGuess };
    }
  }
  return queries;
}
