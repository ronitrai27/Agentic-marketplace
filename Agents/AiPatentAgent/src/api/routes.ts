/**
 * REST + SSE API.
 * Contract: DB row is truth; SSE is a live view of it. Tenant comes from
 * X-Tenant-Id (or demo), enforced by RLS through withTenant().
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { config } from '../config.js';
import { bus, type SseEvent } from '../lib/events.js';
import { parseUpload, UnreadableFileError, DraftTooLargeError } from '../parse/documents.js';
import { embedTexts, hashEmbed } from '../embed/embed.js';
import { chatJSON } from '../llm/chain.js';
import { connectorStatuses } from '../connectors/index.js';
import { dbHealth, withTenant, createAnalysis, getAnalysis, listAnalyses, deleteAnalysis, findByRunId, checkDraftCache, loadAgentMessages, getBilling, loadClaims, loadMatches, loadReferences, searchScopeEmbeddings, ensureTenant, appendAgentMessage, type AnalysisRow } from '../store/db.js';
import { T } from '../workflow/types.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function tenantOf(req: FastifyRequest): string {
  const h = req.headers['x-tenant-id'];
  const cfg = config();
  // Header (REST calls)
  if (typeof h === 'string' && UUID.test(h)) return h.toLowerCase();
  // Query param (SSE/EventSource — cannot send headers)
  const q = (req.query as Record<string, string>)['tenant'];
  if (typeof q === 'string' && UUID.test(q)) return q.toLowerCase();
  return cfg.TENANT_DEMO_ID;
}

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  const cfg = config();

  // ── Health & meta ──────────────────────────────────────────────────
  app.get('/health', async () => {
    const db = await dbHealth();
    const sources = connectorStatuses();
    return {
      status: db.ok ? 'ok' : 'degraded',
      version: '0.1.0',
      free_mode: cfg.FREE_MODE,
      jurisdiction: cfg.JURISDICTION ?? 'IN',
      db,
      llm: { configured: cfg.LLM_CHAIN, env: cfg.FREE_MODE ? 'free-first' : 'paid' },
      sources,
      pricing: {
        mode: cfg.PRICING_MODE,
        rate: cfg.RUNTIME_RATE,
        min_fee: cfg.MIN_RUN_FEE,
        max_fee: cfg.MAX_RUN_FEE,
        paypal: cfg.PAYPAL_MODE,
      },
    };
  });

  app.get('/api/meta', async () => ({
    templates: T,
    team: [
      { id: 'ari',          name: 'Ari',          role: 'Intake & scorecard narration' },
      { id: 'scout',        name: 'Scout',        role: 'Query formulation & India IPO search' },
      { id: 'clerk',        name: 'Clerk',        role: 'Dedup & family merge' },
      { id: 'cartographer', name: 'Cartographer', role: 'Claim charting (Indian Patents Act)' },
      { id: 'examiner',     name: 'Examiner',     role: 'Overlap verdicts & §3/§2(1)(j) flags' },
    ],
    ui: { showTeamRail: cfg.SHOW_TEAM_RAIL, uiMode: cfg.UI_MODE },
    limits: {
      max_draft_chars: cfg.MAX_DRAFT_CHARS,
      max_candidates: cfg.MAX_CANDIDATES,
      max_cross_referenced: cfg.MAX_CROSS_REFERENCED,
      max_claims: cfg.MAX_CLAIMS,
      max_file_bytes: cfg.MAX_FILE_BYTES,
    },
    jurisdiction: cfg.JURISDICTION ?? 'IN',
    sse_event_types: [
      'stage', 'progress', 'candidate_found', 'cell_decided',
      'agent_msg', 'ari_line', 'partial_result', 'complete', 'failed',
    ],
  }));

  // ── Create analysis (multipart file or JSON text) ──────────────────
  app.post('/api/analyses', async (req: FastifyRequest, reply: FastifyReply) => {
    const tenantId = tenantOf(req);
    await ensureTenant(tenantId);

    let text: string | undefined;
    let name: string | undefined;
    let buffer: Buffer | undefined;
    let mime: string | undefined;

    if (req.isMultipart()) {
      for await (const part of req.parts()) {
        if (part.type === 'file') {
          buffer = await part.toBuffer();
          name = part.filename;
          mime = part.mimetype;
        } else if (part.fieldname === 'text') {
          text = String(part.value);
        } else if (part.fieldname === 'name') {
          name = String(part.value);
        }
      }
    } else {
      const body = (req.body ?? {}) as { text?: string; name?: string };
      text = body.text;
      name = body.name;
    }

    let parsed;
    try {
      parsed = await parseUpload(
        { text, buffer, name, mime },
        { maxChars: cfg.MAX_DRAFT_CHARS, maxBytes: cfg.MAX_FILE_BYTES },
      );
    } catch (e) {
      if (e instanceof DraftTooLargeError) return reply.code(413).send({ error: { code: 'draft_too_large', message: e.message } });
      if (e instanceof UnreadableFileError) return reply.code(422).send({ error: { code: 'unreadable', message: e.message } });
      throw e;
    }

    const cachedId = await checkDraftCache(tenantId, parsed.hash);
    if (cachedId) {
      const cached = await getAnalysis(cachedId, tenantId);
      if (cached && (cached.status === 'complete' || cached.status === 'queued' || ['ingesting', 'retrieving', 'charting', 'scoring'].includes(cached.status))) {
        return reply.code(200).send({ id: cached.id, cached: true, status: cached.status });
      }
    }

    const row = await createAnalysis({
      tenantId,
      draftHash: parsed.hash,
      inputKind: parsed.kind,
      inputName: name ?? (text ? 'pasted text' : 'upload'),
      draftChars: parsed.chars,
      draftText: parsed.text,
    });

    // Persist Ari's intake line so SSE replay shows it to late-joining clients
    await intakeGreeting(row.id);
    bus.emit(row.id, { type: 'stage', status: 'queued', stage: 'queued' });

    return reply.code(202).send({ id: row.id, status: row.status, warnings: parsed.warnings });
  });

  // ── List / read / delete ───────────────────────────────────────────
  app.get('/api/analyses', async (req) => {
    const tenantId = tenantOf(req);
    const limit = Number((req.query as { limit?: string }).limit ?? 20);
    return { analyses: await listAnalyses(tenantId, Math.min(100, Math.max(1, limit))) };
  });

  app.get<{ Params: { id: string } }>('/api/analyses/:id', async (req, reply) => {
    const tenantId = tenantOf(req);
    const row = await getAnalysis(req.params.id, tenantId);
    if (!row) return reply.code(404).send({ error: { code: 'not_found', message: 'no such analysis (or not yours)' } });

    const [claims, matches, refs, messages, billing] = [
      await loadClaims(row.id),
      await loadMatches(row.id),
      await loadReferences(row.id),
      await loadAgentMessages(row.id),
      await getBilling(row.id),
    ];
    return {
      analysis: publicAnalysis(row),
      claims: claims.claims,
      elements: claims.elements,
      references: refs,
      matches,
      messages,
      billing,
      result: row.result,
      error: row.error,
    };
  });

  app.delete<{ Params: { id: string } }>('/api/analyses/:id', async (req, reply) => {
    const ok = await deleteAnalysis(req.params.id, tenantOf(req));
    if (!ok) return reply.code(404).send({ error: { code: 'not_found', message: 'no such analysis' } });
    return { deleted: true, id: req.params.id };
  });

  // ── SSE stream (Team Rail + Desk live) ─────────────────────────────
  app.get<{ Params: { id: string } }>('/api/analyses/:id/stream', async (req, reply) => {
    const tenantId = tenantOf(req);
    const row = await getAnalysis(req.params.id, tenantId);
    if (!row) return reply.code(404).send({ error: { code: 'not_found', message: 'no such analysis' } });

    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'access-control-allow-origin': '*',
    });

    const send = (ev: SseEvent | { type: 'snapshot'; analysis: unknown }) => {
      try {
        reply.raw.write(`data: ${JSON.stringify(ev)}\n\n`);
      } catch {
        /* client gone */
      }
    };

    // Replay persisted Team Rail messages first (guarantee #1: truth is the DB)
    const messages = await loadAgentMessages(row.id);
    for (const m of messages) {
      send({
        type: 'agent_msg',
        seq: m.seq,
        from: m.from_agent as never,
        to: m.to_agent as never,
        template_id: m.template_id,
        payload: m.payload,
      });
    }
    send({ type: 'snapshot', analysis: publicAnalysis(row) });
    if (row.status === 'complete' || row.status === 'failed') {
      send(row.status === 'complete' ? { type: 'complete', analysis_id: row.id } : { type: 'failed', error: (row.error as never) ?? { message: 'failed', retriable: false } });
      reply.raw.end();
      return reply;
    }

    const unsubscribe = bus.subscribe(row.id, (ev) => send(ev));
    const heartbeat = setInterval(() => {
      try {
        reply.raw.write(`data: {"type":"ping"}\n\n`);
      } catch {
        /* ignore */
      }
    }, 15_000);

    const close = () => {
      unsubscribe();
      clearInterval(heartbeat);
      try {
        reply.raw.end();
      } catch {
        /* ignore */
      }
    };
    req.raw.on('close', close);
    req.raw.on('error', close);
    return reply;
  });

  // ── Marketplace contract: POST /execute (idempotent, dryRun) ───────
  app.post('/execute', async (req: FastifyRequest, reply: FastifyReply) => {
    const body = (req.body ?? {}) as {
      run_id?: string;
      tenant_id?: string;
      dryRun?: boolean;
      payload?: { text?: string; name?: string; file_base64?: string };
    };

    if (body.dryRun) {
      const db = await dbHealth();
      return {
        dryRun: true,
        ok: db.ok,
        deps: { db, sources: connectorStatuses(), free_mode: cfg.FREE_MODE },
        pricing: { mode: cfg.PRICING_MODE, max_fee: cfg.MAX_RUN_FEE, paypal: cfg.PAYPAL_MODE },
      };
    }

    if (!body.run_id) {
      return reply.code(400).send({ error: { code: 'missing_run_id', message: 'run_id is required for idempotency' } });
    }

    const existing = await findByRunId(body.run_id);
    if (existing) {
      return reply.code(200).send({ accepted: true, analysis_id: existing.id, idempotent: true, status: existing.status });
    }

    const tenantId = (body.tenant_id && UUID.test(body.tenant_id) ? body.tenant_id : tenantOf(req)).toLowerCase();
    await ensureTenant(tenantId);

    const rawText = body.payload?.text;
    const decoded = body.payload?.file_base64
      ? Buffer.from(body.payload.file_base64, 'base64')
      : undefined;

    let parsed;
    try {
      parsed = await parseUpload(
        { text: rawText, buffer: decoded, name: body.payload?.name },
        { maxChars: cfg.MAX_DRAFT_CHARS, maxBytes: cfg.MAX_FILE_BYTES },
      );
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return reply.code(422).send({ error: { code: 'bad_payload', message } });
    }

    const row = await createAnalysis({
      tenantId,
      runId: body.run_id,
      draftHash: parsed.hash,
      inputKind: parsed.kind,
      inputName: body.payload?.name ?? 'execute payload',
      draftChars: parsed.chars,
      draftText: parsed.text,
    });
    await intakeGreeting(row.id);

    return reply.code(202).send({ accepted: true, analysis_id: row.id, max_run_fee: cfg.MAX_RUN_FEE });
  });

  // ── Grounded follow-up over THIS run's evidence (F25) ──────────────
  app.post<{ Params: { id: string } }>('/api/analyses/:id/ask', async (req, reply) => {
    const tenantId = tenantOf(req);
    const row = await getAnalysis(req.params.id, tenantId);
    if (!row) return reply.code(404).send({ error: { code: 'not_found', message: 'no such analysis' } });

    const q = String((req.body as { q?: string })?.q ?? '').trim();
    if (!q) return reply.code(400).send({ error: { code: 'missing_q', message: 'q is required' } });

    const [vecs, runRefs] = await Promise.all([
      embedTexts([q]),
      loadReferences(row.id),
    ]);
    const queryVec = vecs[0];
    const refs = runRefs;
    const hits = await searchScopeEmbeddings(`analysis:${row.id}`, queryVec ?? hashEmbed(q), 8);
    const qTokens = new Set(
      q.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((t) => t.length > 3),
    );
    const evidence = hits
      .map((h) => {
        const emb = 1 - Number(h.dist); // cosine similarity
        const text = h.content.toLowerCase();
        let lex = 0;
        for (const t of qTokens) if (text.includes(t)) lex++;
        const lexical = qTokens.size ? lex / qTokens.size : 0;
        return { h, score: 0.45 * Math.max(0, emb) + 0.55 * lexical };
      })
      .filter((x) => x.score >= 0.22)
      .sort((a, b) => b.score - a.score)
      .map((x) => ({
        kind: x.h.ref_key?.startsWith('claim:') ? 'claim' : 'reference',
        ref: x.h.ref_key,
        content: x.h.content,
        similarity: Number(x.score.toFixed(3)),
      }));

    // Meta-questions ("which reference is the biggest risk?", "which claim is weakest?")
    // won't match reference snippets by keyword. Fall back to the run's own scorecard +
    // top-ranked references as grounded evidence, so Ari can still answer from THIS run.
    if (evidence.length < 2) {
      const res = row.result as {
        red_flags?: string[];
        rewrite_suggestions?: string[];
        closest_reference_note?: string;
        per_claim?: { claimNo: number; overlapPct: number; risk: string }[];
        novelty_score?: number;
        verdict?: string;
      } | null;
      if (res) {
        // These strings end up read by a first-time user in the rail, so write them the
        // way a person talks, not the way the database stores them.
        const verdictPlain: Record<string, string> = {
          lack_of_novelty: 'the invention already exists in the prior art',
          lack_of_inventive_step: 'the invention is close to existing work',
          partial_overlap: 'some parts overlap with existing work',
          clear: 'no blocking prior art was found',
        };
        const riskPlain: Record<string, string> = {
          lack_of_novelty: 'no novelty',
          lack_of_inventive_step: 'needs stronger claims',
          partial_overlap: 'partial overlap',
          clear: 'looks original',
        };
        const facts: string[] = [];
        if (typeof res.novelty_score === 'number')
          facts.push(
            `Novelty score ${res.novelty_score}/100 — ${verdictPlain[res.verdict ?? ''] ?? res.verdict ?? 'not scored yet'}.`,
          );
        if (res.closest_reference_note) facts.push(res.closest_reference_note);
        for (const c of res.per_claim ?? [])
          facts.push(`Claim ${c.claimNo}: ${c.overlapPct}% similar to what is already published (${riskPlain[c.risk] ?? c.risk}).`);
        for (const f of (res.red_flags ?? []).slice(0, 5)) facts.push(`Risk flag: ${f}`);
        for (const s of (res.rewrite_suggestions ?? []).slice(0, 3)) facts.push(`Suggestion: ${s}`);
        for (const ref of refs.filter((x) => x.selected).slice(0, 5))
          facts.push(`Closest document: ${ref.publication_number ?? ref.url} — ${ref.title ?? '(untitled)'}.`);
        const scorecardText = facts.join('\n');
        if (scorecardText) {
          evidence.unshift({
            kind: 'scorecard',
            ref: 'scorecard for this run',
            content: scorecardText,
            similarity: 1,
          });
        }
      }
    }

    if (!evidence.length) {
      return {
        answer: 'I could not find supporting evidence in this run for that question — try asking about a specific claim, element, or reference number.',
        evidence: [],
        grounded: true,
      };
    }

    const summary = row.result ? JSON.stringify(row.result).slice(0, 3000) : '';
    const askSchema = z.object({ answer: z.string(), citations: z.array(z.string()).default([]) });
    let answer: string;
    let citations: string[] = [];
    try {
      const r = await chatJSON({
        system:
          'Answer ONLY from the provided evidence (excerpts from this run). Cite claim numbers or reference ids. ' +
          'If evidence is insufficient say exactly that.',
        user: `QUESTION: ${q}\n\nEVIDENCE:\n${evidence.map((e, i) => `[${i + 1}] (${e.ref}) ${e.content.slice(0, 600)}`).join('\n\n')}\n\nRUN SUMMARY: ${summary}`,
        schema: askSchema,
        temperature: 0,
      });
      answer = r.data.answer.trim();
      citations = r.data.citations ?? [];
      if (!answer) throw new Error('empty');
    } catch {
      // No AI key on this run: hand back what we DO know. The scorecard evidence already
      // carries line breaks, so keep them (the UI renders this with white-space: pre-wrap)
      // and clip only at a word boundary — never mid-sentence with no ellipsis.
      const clip = (s: string, n: number): string => {
        const t = s.trim();
        if (t.length <= n) return t;
        return t.slice(0, n).replace(/\s+\S*$/, '') + ' …';
      };
      const bits = evidence
        .slice(0, 3)
        .map((e) => clip(e.content, e.kind === 'scorecard' ? 900 : 300));
      answer =
        `I can't write a fuller answer without an AI key. Here is what this run did find:\n\n` +
        bits.join('\n\n') +
        `\n\nAdd an AI key and ask again, and I'll answer your question directly.`;
    }

    return { answer, citations, evidence: evidence.slice(0, 5), grounded: true };
  });
}

async function intakeGreeting(analysisId: string): Promise<void> {
  const seq = await appendAgentMessage(analysisId, {
    from: 'ari',
    to: 'scout',
    template: T.intakeConfirmed,
    payload: { queued: true },
  });
  bus.emit(analysisId, {
    type: 'agent_msg',
    seq,
    from: 'ari',
    to: 'scout',
    template_id: T.intakeConfirmed,
    payload: { queued: true },
  });
  bus.emit(analysisId, { type: 'ari_line', template_id: 'ari.intake', payload: { queued: true } });
}

function publicAnalysis(row: AnalysisRow) {
  return {
    id: row.id,
    status: row.status,
    stage: row.stage,
    input_kind: row.input_kind,
    input_name: row.input_name,
    draft_chars: row.draft_chars,
    novelty_score: row.novelty_score,
    verdict: row.verdict,
    run_id: row.run_id,
    created_at: row.created_at,
    started_at: row.started_at,
    completed_at: row.completed_at,
  };
}
