import pg from 'pg';
import { config } from '../config.js';

const { Pool } = pg;

/**
 * Ops pool — patent_ops role (BYPASSRLS): queue polling, worker writes, maintenance.
 * Falls back to the app URL with ops credentials swapped in, so a single
 * DATABASE_URL is enough for local dev (DATABASE_OPS_URL overrides).
 */
function deriveOpsUrl(appUrl: string): string {
  try {
    const u = new URL(appUrl);
    u.username = 'patent_ops';
    u.password = 'patent_ops_pw';
    return u.toString();
  } catch {
    return appUrl;
  }
}

export const appPool = new Pool({
  connectionString: config().DATABASE_URL,
  max: 10,
  statement_timeout: 30_000,
  idle_in_transaction_session_timeout: 15_000,
});

export const opsPool = new Pool({
  connectionString: config().DATABASE_OPS_URL || deriveOpsUrl(config().DATABASE_URL),
  max: 5,
  statement_timeout: 60_000,
});

export type AnalysisStatus =
  | 'queued'
  | 'ingesting'
  | 'retrieving'
  | 'charting'
  | 'scoring'
  | 'complete'
  | 'failed';

export interface AnalysisRow {
  id: string;
  tenant_id: string;
  listing_id: string | null;
  run_id: string | null;
  revision: number;
  parent_id: string | null;
  status: AnalysisStatus;
  stage: string | null;
  input_kind: string | null;
  input_name: string | null;
  draft_hash: string;
  draft_chars: number | null;
  draft_text: string | null;
  novelty_score: number | null;
  verdict: string | null;
  result: unknown;
  error: unknown;
  created_at: Date;
  started_at: Date | null;
  completed_at: Date | null;
}

/** Run a block with the app tenant set — RLS anchor. */
export async function withTenant<T>(tenantId: string, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await appPool.connect();
  try {
    await c.query('BEGIN');
    await c.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId]);
    const out = await fn(c);
    await c.query('COMMIT');
    return out;
  } catch (e) {
    try {
      await c.query('ROLLBACK');
    } catch {
      /* ignore */
    }
    throw e;
  } finally {
    c.release();
  }
}

/** Ops-side query (queue, worker). */
export function opsQ<T extends pg.QueryResultRow = pg.QueryResultRow>(
  sql: string,
  params: unknown[] = [],
): Promise<pg.QueryResult<T>> {
  return opsPool.query<T>(sql, params as unknown[]);
}

export const seq = async (c: pg.PoolClient): Promise<pg.QueryResult> => c.query('SELECT 1');

// ── Analyses ──────────────────────────────────────────────────────────

export interface CreateAnalysisInput {
  tenantId: string;
  listingId?: string | null;
  runId?: string | null;
  draftHash: string;
  inputKind: string;
  inputName?: string | null;
  draftChars: number;
  draftText: string; // purged when the run finishes (see DATABASE §4)
}

export async function createAnalysis(input: CreateAnalysisInput): Promise<AnalysisRow> {
  return withTenant(input.tenantId, async (c) => {
    const r = await c.query<AnalysisRow>(
      `INSERT INTO analyses (tenant_id, listing_id, run_id, draft_hash, input_kind, input_name, draft_chars, draft_text, status)
       VALUES ($1, (SELECT id FROM agent_listings WHERE slug='ai-patent-agent'), $2, $3, $4, $5, $6, $7, 'queued')
       RETURNING *`,
      [input.tenantId, input.runId ?? null, input.draftHash, input.inputKind, input.inputName ?? null, input.draftChars, input.draftText],
    );
    const row = r.rows[0]!;
    await c.query(
      `INSERT INTO billing_records (analysis_id, run_id, tenant_id, mode, rate)
       VALUES ($1, $2, $3, $4, $5)`,
      [row.id, input.runId ?? row.id, input.tenantId, config().PRICING_MODE, config().RUNTIME_RATE],
    );
    await c.query(
      `INSERT INTO run_costs (analysis_id) VALUES ($1) ON CONFLICT DO NOTHING`,
      [row.id],
    );
    await c.query(
      `INSERT INTO draft_cache (tenant_id, draft_hash, analysis_id) VALUES ($1, $2, $3)
       ON CONFLICT (tenant_id, draft_hash)
       DO UPDATE SET analysis_id = EXCLUDED.analysis_id, created_at = now(),
                     expires_at = now() + INTERVAL '30 days'`,
      [input.tenantId, input.draftHash, row.id],
    );
    return row;
  });
}

const tenantPrimed = new Set<string>();

/** Marketplace BYOS: buyers arrive with their own tenant id — provision it idempotently. */
export async function ensureTenant(id: string): Promise<void> {
  if (tenantPrimed.has(id)) return;
  await opsQ(
    `INSERT INTO tenants (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`,
    [id, `tenant-${id.slice(0, 8)}`],
  );
  tenantPrimed.add(id);
}

export async function getAnalysisTenant(analysisId: string): Promise<string | null> {
  const r = await opsQ<{ tenant_id: string }>('SELECT tenant_id FROM analyses WHERE id = $1', [analysisId]);
  return r.rows[0]?.tenant_id ?? null;
}

export async function getAnalysis(id: string, tenantId: string): Promise<AnalysisRow | null> {
  return withTenant(tenantId, async (c) => {
    const r = await c.query<AnalysisRow>('SELECT * FROM analyses WHERE id = $1', [id]);
    return r.rows[0] ?? null;
  });
}

export async function listAnalyses(tenantId: string, limit = 20): Promise<AnalysisRow[]> {
  return withTenant(tenantId, async (c) => {
    const r = await c.query<AnalysisRow>(
      `SELECT id, status, stage, input_kind, input_name, draft_hash, novelty_score, verdict, created_at, completed_at, run_id
       FROM analyses WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT $2`,
      [tenantId, limit],
    );
    return r.rows as AnalysisRow[];
  });
}

export async function deleteAnalysis(id: string, tenantId: string): Promise<boolean> {
  return withTenant(tenantId, async (c) => {
    const r = await c.query('DELETE FROM analyses WHERE id = $1', [id]);
    return (r.rowCount ?? 0) > 0;
  });
}

/** Idempotent lookup by marketplace run id. */
export async function findByRunId(runId: string): Promise<AnalysisRow | null> {
  const r = await opsQ<AnalysisRow>('SELECT * FROM analyses WHERE run_id = $1', [runId]);
  return r.rows[0] ?? null;
}

export interface ListingRow {
  id: string;
  slug: string;
  pricing_mode: 'runtime' | 'tier';
  runtime_rate: number | null;
  min_run_fee: number;
  max_run_fee: number;
  tiers: { name: string; price: number; caps?: { claims?: number; refs?: number } }[] | null;
}

export async function getListing(slug = 'ai-patent-agent'): Promise<ListingRow | null> {
  const r = await opsQ<ListingRow>('SELECT id, slug, pricing_mode, runtime_rate, min_run_fee, max_run_fee, tiers FROM agent_listings WHERE slug = $1', [slug]);
  return r.rows[0] ?? null;
}

/** Merge a JSONB patch into the stored result (e.g. attach billing after completion). */
export async function mergeResult(id: string, patch: Record<string, unknown>): Promise<void> {
  await opsQ(
    `UPDATE analyses SET result = COALESCE(result, '{}'::jsonb) || $2::jsonb WHERE id = $1`,
    [id, JSON.stringify(patch)],
  );
}

export async function checkDraftCache(tenantId: string, draftHash: string): Promise<string | null> {
  return withTenant(tenantId, async (c) => {
    const r = await c.query<{ analysis_id: string }>(
      `SELECT analysis_id FROM draft_cache
       WHERE tenant_id = $1 AND draft_hash = $2 AND expires_at > now()`,
      [tenantId, draftHash],
    );
    return r.rows[0]?.analysis_id ?? null;
  });
}

/**
 * Optimistic status transition (DATABASE §8.1): only legal transitions advance;
 * a race between two workers affects 0 rows → caller aborts.
 */
export async function advanceStatus(
  id: string,
  from: AnalysisStatus[],
  to: AnalysisStatus,
  stage?: string,
  extra?: { started?: boolean; completed?: boolean; score?: number; verdict?: string; result?: unknown; error?: unknown },
): Promise<boolean> {
  const sets: string[] = ['status = $2'];
  const params: unknown[] = [id, to];
  if (stage !== undefined) {
    params.push(stage);
    sets.push(`stage = $${params.length}`);
  }
  if (extra?.started) sets.push('started_at = COALESCE(started_at, now())');
  if (extra?.completed) sets.push('completed_at = now()');
  if (extra?.score !== undefined) {
    params.push(extra.score);
    sets.push(`novelty_score = $${params.length}`);
  }
  if (extra?.verdict !== undefined) {
    params.push(extra.verdict);
    sets.push(`verdict = $${params.length}::verdict_type`);
  }
  if (extra?.result !== undefined) {
    params.push(JSON.stringify(extra.result));
    sets.push(`result = $${params.length}::jsonb`);
  }
  if (extra?.error !== undefined) {
    params.push(JSON.stringify(extra.error));
    sets.push(`error = $${params.length}::jsonb`);
  }
  params.push(from);
  const r = await opsQ(
    `UPDATE analyses SET ${sets.join(', ')} WHERE id = $1 AND status = ANY($${params.length}::analysis_status[])`,
    params,
  );
  return (r.rowCount ?? 0) > 0;
}

/** Confidentiality: draft content lives only while the run is executing. */
export async function purgeDraft(id: string): Promise<void> {
  await opsQ(`UPDATE analyses SET draft_text = NULL WHERE id = $1 AND status IN ('complete','failed')`, [id]);
}

// ── Claims ────────────────────────────────────────────────────────────

export interface ClaimRow {
  id: number;
  claim_no: number;
  type: 'independent' | 'dependent';
  provisional: boolean;
  text: string;
}
export interface ElementRow {
  id: number;
  claim_id: number;
  element_no: number;
  text: string;
  weight: number;
}

export async function saveClaims(
  analysisId: string,
  claims: { claimNo: number; type: 'independent' | 'dependent'; provisional: boolean; text: string; elements: { elementNo: number; text: string; weight: number }[] }[],
): Promise<{ claims: ClaimRow[]; elements: ElementRow[] }> {
  const claimsOut: ClaimRow[] = [];
  const elementsOut: ElementRow[] = [];
  for (const cl of claims) {
    const r = await opsQ<ClaimRow>(
      `INSERT INTO claims (analysis_id, claim_no, type, provisional, text)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (analysis_id, claim_no) DO UPDATE SET text = EXCLUDED.text
       RETURNING id, claim_no, type, provisional, text`,
      [analysisId, cl.claimNo, cl.type, cl.provisional, cl.text],
    );
    const claim = r.rows[0]!;
    claimsOut.push(claim);
    for (const el of cl.elements) {
      const er = await opsQ<ElementRow>(
        `INSERT INTO claim_elements (claim_id, element_no, text, weight)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (claim_id, element_no) DO UPDATE SET text = EXCLUDED.text, weight = EXCLUDED.weight
         RETURNING id, claim_id, element_no, text, weight`,
        [claim.id, el.elementNo, el.text, el.weight],
      );
      elementsOut.push(er.rows[0]!);
    }
  }
  return { claims: claimsOut, elements: elementsOut };
}

export async function loadClaims(analysisId: string): Promise<{ claims: ClaimRow[]; elements: ElementRow[] }> {
  const claims = (await opsQ<ClaimRow>(
    'SELECT id, claim_no, type, provisional, text FROM claims WHERE analysis_id = $1 ORDER BY claim_no',
    [analysisId],
  )).rows;
  const elements = (await opsQ<ElementRow>(
    `SELECT e.id, e.claim_id, e.element_no, e.text, e.weight
     FROM claim_elements e JOIN claims c ON c.id = e.claim_id
     WHERE c.analysis_id = $1 ORDER BY c.claim_no, e.element_no`,
    [analysisId],
  )).rows;
  return { claims, elements };
}

// ── References ────────────────────────────────────────────────────────

export interface ReferenceRow {
  id: number;
  analysis_id: string;
  publication_number: string | null;
  kind: 'patent' | 'npl' | 'web';
  office: string | null;
  title: string | null;
  assignee: string | null;
  cpc: string | null;
  priority_date: string | null;
  publication_date: string | null;
  url: string;
  rank_score: number | null;
  rank_breakdown: unknown;
  selected: boolean;
  snippet: string | null;
  source: string | null;
}

export interface NewReference {
  publicationNumber?: string;
  familyId?: string;
  kind: 'patent' | 'npl' | 'web';
  office?: string;
  title?: string;
  assignee?: string;
  cpc?: string;
  priorityDate?: string;
  publicationDate?: string;
  url: string;
  snippet: string;
  source: string;
}

export async function saveReferences(analysisId: string, refs: NewReference[]): Promise<ReferenceRow[]> {
  const out: ReferenceRow[] = [];
  for (const r of refs) {
    const res = await opsQ<ReferenceRow>(
      `INSERT INTO references_
         (analysis_id, publication_number, family_id, kind, office, title, assignee, cpc,
          priority_date, publication_date, url, snippet, source)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::date,$10::date,$11,$12,$13)
       ON CONFLICT (analysis_id, publication_number) DO NOTHING
       RETURNING *`,
      [
        analysisId,
        r.publicationNumber ?? null,
        r.familyId ?? null,
        r.kind,
        r.office ?? null,
        r.title ?? null,
        r.assignee ?? null,
        r.cpc ?? null,
        r.priorityDate ?? null,
        r.publicationDate ?? null,
        r.url,
        r.snippet,
        r.source ?? null,
      ],
    );
    if (res.rows[0]) out.push(res.rows[0]);
  }
  return out;
}

export async function rankReferences(
  analysisId: string,
  ranked: { id: number; score: number; breakdown: Record<string, number>; selected: boolean }[],
): Promise<void> {
  for (const r of ranked) {
    await opsQ(
      `UPDATE references_ SET rank_score = $2, rank_breakdown = $3, selected = $4 WHERE id = $1`,
      [r.id, r.score, JSON.stringify(r.breakdown), r.selected],
    );
  }
}

export async function loadReferences(analysisId: string): Promise<ReferenceRow[]> {
  return (await opsQ<ReferenceRow>(
    'SELECT * FROM references_ WHERE analysis_id = $1 ORDER BY rank_score DESC NULLS LAST',
    [analysisId],
  )).rows;
}

// ── Claim matches ─────────────────────────────────────────────────────

export interface MatchRow {
  id: number;
  claim_id: number;
  element_id: number;
  reference_id: number;
  match: 'disclosed' | 'partial' | 'not_found';
  quote: string | null;
  locator: string | null;
  commentary: string | null;
}

export async function saveMatches(
  analysisId: string,
  matches: { claimId: number; elementId: number; referenceId: number; match: string; quote?: string | null; locator?: string | null; commentary?: string | null }[],
): Promise<void> {
  for (const m of matches) {
    await opsQ(
      `INSERT INTO claim_matches (analysis_id, claim_id, element_id, reference_id, match, quote, locator, commentary)
       VALUES ($1,$2,$3,$4,$5::match_type,$6,$7,$8)
       ON CONFLICT (element_id, reference_id)
       DO UPDATE SET match = EXCLUDED.match, quote = EXCLUDED.quote, locator = EXCLUDED.locator, commentary = EXCLUDED.commentary`,
      [analysisId, m.claimId, m.elementId, m.referenceId, m.match, m.quote ?? null, m.locator ?? null, m.commentary ?? null],
    );
  }
}

export async function loadMatches(analysisId: string): Promise<MatchRow[]> {
  return (await opsQ<MatchRow>('SELECT * FROM claim_matches WHERE analysis_id = $1', [analysisId])).rows;
}

// ── Team rail messages ────────────────────────────────────────────────

export interface AgentMessageRow {
  seq: number;
  from_agent: string;
  to_agent: string;
  template_id: string;
  payload: Record<string, unknown>;
}

export async function appendAgentMessage(
  analysisId: string,
  msg: { from: string; to: string; template: string; payload: Record<string, unknown> },
): Promise<number> {
  const r = await opsQ<{ seq: number }>(
    `INSERT INTO agent_messages (analysis_id, seq, from_agent, to_agent, template_id, payload)
     VALUES (
       $1,
       COALESCE((SELECT MAX(seq) FROM agent_messages WHERE analysis_id = $1), 0) + 1,
       $2::agent_role, $3::agent_role, $4, $5)
     RETURNING seq`,
    [analysisId, msg.from, msg.to, msg.template, JSON.stringify(msg.payload)],
  );
  return r.rows[0]!.seq;
}

export async function loadAgentMessages(analysisId: string): Promise<AgentMessageRow[]> {
  return (await opsQ<AgentMessageRow>(
    'SELECT seq, from_agent, to_agent, template_id, payload FROM agent_messages WHERE analysis_id = $1 ORDER BY seq',
    [analysisId],
  )).rows;
}

// ── Embeddings (per-analysis scope: grounded follow-up) ───────────────

export async function upsertEmbeddings(
  scope: string,
  kind: string,
  rows: { refKey?: string; content: string; contentHash: string; vector: number[] }[],
): Promise<void> {
  for (const r of rows) {
    const vec = `[${r.vector.join(',')}]`;
    await opsQ(
      `INSERT INTO embeddings (scope, kind, ref_key, content, content_hash, embedding)
       VALUES ($1,$2,$3,$4,$5,$6::vector)
       ON CONFLICT (content_hash, kind) DO NOTHING`,
      [scope, kind, r.refKey ?? null, r.content, r.contentHash, vec],
    );
  }
}

export async function searchScopeEmbeddings(
  scope: string,
  queryVec: number[],
  limit = 8,
): Promise<{ content: string; ref_key: string | null; dist: number }[]> {
  const r = await opsQ<{ content: string; ref_key: string | null; dist: number }>(
    `SELECT content, ref_key, (embedding <=> $2::vector) AS dist
     FROM embeddings WHERE scope = $1
     ORDER BY embedding <=> $2::vector LIMIT $3`,
    [scope, `[${queryVec.join(',')}]`, limit],
  );
  return r.rows;
}

// ── Billing / costs ───────────────────────────────────────────────────

export interface BillingRow {
  id: string;
  analysis_id: string;
  run_id: string;
  tenant_id: string;
  mode: 'runtime' | 'tier';
  rate: number | null;
  tier_name: string | null;
  billable_seconds: number;
  price: number | null;
  state: string;
  paypal_auth_id: string | null;
}

export async function getBilling(analysisId: string): Promise<BillingRow | null> {
  const r = await opsQ<BillingRow>('SELECT * FROM billing_records WHERE analysis_id = $1', [analysisId]);
  return r.rows[0] ?? null;
}

export async function setBillingAuthorized(analysisId: string, authId: string): Promise<void> {
  await opsQ(`UPDATE billing_records SET state='authorized', paypal_auth_id=$2 WHERE analysis_id=$1`, [
    analysisId,
    authId,
  ]);
}

export async function finalizeBilling(
  analysisId: string,
  billableSeconds: number,
  price: number,
  state: 'captured' | 'partial_captured' | 'voided',
  captureId?: string,
): Promise<void> {
  await opsQ(
    `UPDATE billing_records SET billable_seconds=$2, price=$3, state=$4, paypal_capture_id=$5, updated_at=now()
     WHERE analysis_id=$1`,
    [analysisId, billableSeconds, price, state, captureId ?? null],
  );
}

export async function recordRunCost(
  analysisId: string,
  cost: { tokensIn: number; tokensOut: number; bigqueryBytes: number; connectorCalls: Record<string, number>; estCostUsd: number },
): Promise<void> {
  await opsQ(
    `UPDATE run_costs SET llm_tokens_in=$2, llm_tokens_out=$3, bigquery_bytes=$4,
       connector_calls=$5, est_cost_usd=$6, measured_at=now()
     WHERE analysis_id=$1`,
    [analysisId, cost.tokensIn, cost.tokensOut, cost.bigqueryBytes, JSON.stringify(cost.connectorCalls), cost.estCostUsd],
  );
}

// ── Queue (Postgres is the durable queue: SKIP LOCKED claim) ──────────

/**
 * Queue claim (Postgres is the durable queue): SKIP LOCKED pick, and a tenant
 * may only hold TENANT_CONCURRENCY active runs — concurrent rentals stay independent.
 */
export async function claimNextQueued(maxPerTenant = 2): Promise<{ id: string; tenant_id: string } | null> {
  const c = await opsPool.connect();
  try {
    await c.query('BEGIN');
    const r = await c.query<{ id: string; tenant_id: string }>(
      `SELECT a.id, a.tenant_id FROM analyses a
       WHERE a.status = 'queued'
         AND (SELECT count(*) FROM analyses b
              WHERE b.tenant_id = a.tenant_id
                AND b.status NOT IN ('queued','complete','failed')) < $1
       ORDER BY a.created_at LIMIT 1 FOR UPDATE SKIP LOCKED`,
      [maxPerTenant],
    );
    const row = r.rows[0];
    if (!row) {
      await c.query('COMMIT');
      return null;
    }
    const upd = await c.query(
      `UPDATE analyses SET status='ingesting', stage='ingest', started_at=now()
       WHERE id=$1 AND status='queued'`,
      [row.id],
    );
    await c.query('COMMIT');
    return (upd.rowCount ?? 0) > 0 ? row : null;
  } catch (e) {
    await c.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    c.release();
  }
}

export async function activeTenantRuns(tenantId: string): Promise<number> {
  const r = await opsQ<{ n: string }>(
    `SELECT count(*) AS n FROM analyses WHERE tenant_id=$1 AND status NOT IN ('queued','complete','failed')`,
    [tenantId],
  );
  return Number(r.rows[0]?.n ?? 0);
}

// ── Health ────────────────────────────────────────────────────────────

export async function dbHealth(): Promise<{ ok: boolean; detail: string; migration?: string }> {
  try {
    const r = await opsQ<{ v: string }>('SELECT extversion AS v FROM pg_extension WHERE extname=$1', ['vector']);
    const pgv = await opsQ<{ v: string }>('SELECT version() AS v');
    return {
      ok: true,
      detail: `PostgreSQL ${pgv.rows[0]?.v.match(/PostgreSQL (\S+)/)?.[1] ?? '?'} + vector ${r.rows[0]?.v ?? '?'}`,
    };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e) };
  }
}
