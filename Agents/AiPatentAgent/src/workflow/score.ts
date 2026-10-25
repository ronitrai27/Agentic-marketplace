/**
 * Stage 4 — Scorecard: claim-element math (ARCHITECTURE §8) + red flags + rewrites.
 * The LLM narrates only over structured data; deterministic fallbacks when offline.
 */
import { config } from '../config.js';
import { computeScorecard, type ScorecardMath } from '../scoring/overlap.js';
import { LlmVerdictSchema, type LlmVerdict } from '../llm/chain.js';
import { loadClaims, loadMatches, loadReferences, type MatchRow } from '../store/db.js';
import { T, trackedChat, type RunContext } from './types.js';

export interface ScoreResult extends ScorecardMath {
  novelty_score: number;       // snake_case alias of noveltyScore for API/UI
  per_claim: ScorecardMath['perClaim']; // snake_case alias for frontend
  red_flags: string[];
  rewrite_suggestions: string[];
  closest_reference_note: string;
  coverage: {
    sources: RunContext['statuses'];
    warnings: string[];
    refined: boolean;
    llm_mode: 'full' | 'offline';
    chart_mode: 'llm' | 'lexical';
  };
}

export async function scoreStep(ctx: RunContext): Promise<ScoreResult> {
  await ctx.stage('scoring', 'score');

  const { claims, elements } = await loadClaims(ctx.analysis.id);
  const matches = (await loadMatches(ctx.analysis.id)) as MatchRow[];
  const refs = ctx.refs.length ? ctx.refs : await loadReferences(ctx.analysis.id);
  const refById = new Map(refs.map((r) => [r.id, r]));

  const math = computeScorecard(
    claims.map((c) => ({
      claimId: c.id,
      claimNo: c.claim_no,
      type: c.type,
      elements: elements.filter((e) => e.claim_id === c.id).map((e) => ({ id: e.id, weight: Number(e.weight) })),
    })),
    matches,
  );

  const warnings = buildWarnings(ctx, math);
  const chartMode = ctx.chartMode;

  const structured = { ...math, matches, refs, claims, elements };
  const llmVerdict = await trackedChat<LlmVerdict>(ctx, {
    system:
      'You are an Indian patent examiner AI with expertise in the Indian Patents Act 1970 (as amended). ' +
      'From the provided claim-chart statistics produce JSON with three fields: ' +
      'redFlags (specific risks under Indian law — §2(1)(j) novelty, §2(1)(ja) inventive step, ' +
      '§3 exclusions like §3(d) new form of known substance, §3(k) computer programs per se, ' +
      '§3(f) methods of agriculture — name the exact claim and reference for each flag); ' +
      'rewriteSuggestions (concrete claim amendments under Indian drafting conventions that would ' +
      'distinguish over the closest art and avoid §3 exclusions if applicable); ' +
      'closestReferenceNote (one sentence citing the closest Indian/global reference found). ' +
      'Be specific and data-bound. Jurisdiction is India (IPO / CGPDTM). No generic advice.',
    user: JSON.stringify(summarizeForLlm(structured)).slice(0, 9000),
    schema: LlmVerdictSchema,
  });

  const fallback = deterministicNarrative(math, refs, elements, matches);
  const narrative = llmVerdict
    ? {
        redFlags: llmVerdict.redFlags.length ? llmVerdict.redFlags : fallback.redFlags,
        rewriteSuggestions: llmVerdict.rewriteSuggestions.length
          ? llmVerdict.rewriteSuggestions
          : fallback.rewriteSuggestions,
        closestReferenceNote: llmVerdict.closestReferenceNote || fallback.closestReferenceNote,
      }
    : fallback;

  const result: ScoreResult = {
    ...math,
    novelty_score: math.noveltyScore,
    // Explicit snake_case alias so the frontend ScoreResult interface matches
    per_claim: math.perClaim,
    red_flags: narrative.redFlags,
    rewrite_suggestions: narrative.rewriteSuggestions,
    closest_reference_note: narrative.closestReferenceNote,
    coverage: {
      sources: ctx.statuses,
      warnings,
      refined: ctx.refined,
      llm_mode: llmVerdict ? 'full' : 'offline',
      chart_mode: chartMode,
    },
  };

  const patentSourcesOk = ctx.statuses.some((s) => s.source !== 'arxiv' && s.source !== 'tinyfish' && s.state === 'ok');

  await ctx.say({
    from: 'examiner',
    to: 'ari',
    template: T.redFlags,
    payload: { count: narrative.redFlags.length, flags: narrative.redFlags },
  });
  await ctx.say({
    from: 'ari',
    to: 'ari',
    template: T.coverage,
    payload: {
      patent_sources_ok: patentSourcesOk,
      skipped: ctx.statuses.filter((s) => s.state === 'skipped').map((s) => s.source),
      errored: ctx.statuses.filter((s) => s.state === 'error').map((s) => s.source),
      warnings,
    },
  });

  // Persist final result — the DB row is the truth; SSE merely streams it.
  await ctx.stage('complete', 'done', {
    score: math.noveltyScore,
    verdict: math.verdict,
    result: result as unknown,
  });
  await ctx.say({
    from: 'ari',
    to: 'ari',
    template: T.score,
    payload: { score: math.noveltyScore, verdict: math.verdict, worst: math.perClaim.length },
  });
  ctx.progress('scorecard ready', 4, 4);

  return result;
}

function buildWarnings(ctx: RunContext, math: ScorecardMath): string[] {
  const w: string[] = [];
  const skipped = ctx.statuses.filter((s) => s.state === 'skipped');
  const errored = ctx.statuses.filter((s) => s.state === 'error');
  if (!ctx.statuses.some((s) => s.state === 'ok')) {
    w.push('NO_SOURCE_REACHED — every prior-art source was unavailable; the score reflects only the draft, not real art. Treat as invalid.');
  } else if (skipped.length) {
    w.push(`Coverage gap: ${skipped.map((s) => s.source).join(', ')} not searched (${skipped.map((s) => s.reason).join('; ')})`);
  }
  if (errored.length) w.push(`Source errors: ${errored.map((s) => `${s.source} — ${s.reason}`).join('; ')}`);
  if (!ctx.refs.length) w.push('No prior-art references retrieved — novelty score is unconstrained.');
  if (math.noveltyScore === 100 && ctx.refs.length) w.push('No overlap found against retrieved art — check that claims were segmented correctly.');
  return w;
}

function summarizeForLlm(s: {
  perClaim: ScorecardMath['perClaim'];
  noveltyScore: number;
  verdict: string;
  matches: MatchRow[];
  refs: { id: number; publication_number: string | null; title: string | null }[];
  claims: { id: number; claim_no: number; text: string }[];
  elements: { id: number; element_no: number; text: string; claim_id: number }[];
}): unknown {
  const refLabel = new Map(s.refs.map((r) => [r.id, r.publication_number ?? r.title ?? `#${r.id}`]));
  return {
    novelty_score: s.noveltyScore,
    verdict: s.verdict,
    per_claim: s.perClaim.map((c) => ({
      claim_no: c.claimNo,
      type: c.type,
      overlap_pct: c.overlapPct,
      risk: c.risk,
      strongest_refs: c.perRef.slice(0, 3).map((r) => ({ ref: refLabel.get(r.referenceId), overlap_pct: Math.round(r.overlap * 100) })),
    })),
    chart: s.matches.slice(0, 120).map((m) => ({
      ref: refLabel.get(m.reference_id),
      element: s.elements.find((e) => e.id === m.element_id)?.element_no,
      claim: s.claims.find((c) => c.id === m.claim_id)?.claim_no,
      match: m.match,
    })),
  };
}

/** Offline narrative — data-bound templates, never generic filler. */
function deterministicNarrative(
  math: ScorecardMath,
  refs: { id: number; publication_number: string | null; title: string | null }[],
  elements: { id: number; element_no: number; claim_id: number }[],
  matches: MatchRow[],
): { redFlags: string[]; rewriteSuggestions: string[]; closestReferenceNote: string } {
  const refLabel = (id: number): string => {
    const r = refs.find((x) => x.id === id);
    return r ? (r.publication_number ?? r.title ?? `#${id}`) : `#${id}`;
  };

  const redFlags: string[] = [];
  for (const c of math.perClaim) {
    if (c.risk === 'lack_of_novelty') {
      redFlags.push(
        `Claim ${c.claimNo}: fully disclosed (100%) by ${refLabel(c.perRef[0]!.referenceId)} — §2(1)(j) lack of novelty risk.`,
      );
    } else if (c.risk === 'lack_of_inventive_step') {
      const names = c.perRef
        .filter((r) => r.overlap >= 0.3)
        .slice(0, 3)
        .map((r) => `${refLabel(r.referenceId)} (${Math.round(r.overlap * 100)}%)`)
        .join(' + ');
      redFlags.push(`Claim ${c.claimNo}: combination ${names} reaches the §2(1)(ja) inventive step threshold.`);
    } else if (c.overlapPct >= 25) {
      redFlags.push(`Claim ${c.claimNo}: partial overlap ${c.overlapPct}% with ${refLabel(c.perRef[0]!.referenceId)} — review elements manually.`);
    }
  }
  if (!redFlags.length && math.perClaim.length) {
    redFlags.push(`No claim reaches an overlap threshold against the ${refs.length} retrieved reference(s) — score is provisionally clear.`);
  }

  const closest = math.perClaim.reduce<(typeof math.perClaim)[number] | null>(
    (best, c) => (!best || c.overlapPct > best.overlapPct ? c : best),
    null,
  );

  const rewriteSuggestions: string[] = [];
  if (closest && closest.perRef[0]) {
    const strong = matches.filter(
      (m) => m.reference_id === closest.perRef[0]!.referenceId && m.match === 'disclosed',
    );
    const matchedElementNos = strong
      .map((m) => elements.find((e) => e.id === m.element_id)?.element_no)
      .filter((n): n is number => n !== undefined);
    rewriteSuggestions.push(
      `Claim ${closest.claimNo}: elements ${matchedElementNos.join(', ') || '—'} are disclosed in ${refLabel(closest.perRef[0].referenceId)}; add a limitation absent from that reference (its other charted references show where the gap is).`,
    );
  }
  rewriteSuggestions.push(
    'Add an independent claim directed to the specific data-flow/algorithm step that prior art does not chart as "disclosed", and mirror it in dependent claims for fallback scope.',
  );

  return {
    redFlags: redFlags.slice(0, 8),
    rewriteSuggestions: rewriteSuggestions.slice(0, 5),
    closestReferenceNote: closest
      ? `Closest reference: ${refLabel(closest.perRef[0]!.referenceId)} at ${closest.overlapPct}% overlap on claim ${closest.claimNo}.`
      : 'No references retrieved — closest-art analysis unavailable.',
  };
}
