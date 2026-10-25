/**
 * Workflow orchestrator: ingest → retrieve → chart → score → finalize (billing).
 * Owns the whole task lifecycle (marketplace guarantee #1: the browser can vanish
 * mid-run — this function finishes the job from DB state alone).
 */
import { config } from '../config.js';
import { errPayload } from '../lib/util.js';
import { computePrice } from '../scoring/overlap.js';
import { authorize as paypalAuthorize, capture as paypalCapture, voidAuthorization, isMock } from '../payments/paypal.js';
import {
  advanceStatus,
  getAnalysis,
  getBilling,
  getListing,
  mergeResult,
  opsQ,
  purgeDraft,
  finalizeBilling,
  recordRunCost,
  setBillingAuthorized,
} from '../store/db.js';
// BigQuery removed (India-only jurisdiction) — bytes always 0
const lastBytesProcessed = 0;
import { ingestStep } from './ingest.js';
import { retrieveStep } from './retrieve.js';
import { chartStep } from './chart.js';
import { scoreStep } from './score.js';
import { T, makeContext, type RunContext } from './types.js';

export async function runAnalysis(analysisId: string): Promise<void> {
  const row = await loadRow(analysisId);
  if (!row) return;
  if (row.status === 'queued') {
    const claimed = await advanceStatus(analysisId, ['queued'], 'ingesting', 'ingest', { started: true });
    if (!claimed) return;
    row.status = 'ingesting';
    row.started_at = row.started_at ?? new Date();
  }
  if (row.status !== 'ingesting') return;

  const ctx = makeContext(row);

  try {
    await authorizeFee(ctx);
    await ingestStep(ctx);
    await retrieveStep(ctx, 'primary');
    await chartStep(ctx);
    await scoreStep(ctx);
  } catch (e) {
    const error = errPayload(e);
    // Void the escrow hold: no work delivered → no charge (never bills a failure).
    await releaseHold(analysisId).catch(() => undefined);
    await advanceStatus(analysisId, [ctx.status], 'failed', 'error', { error }).catch(() => undefined);
    ctx.status = 'failed';
    await ctx
      .say({ from: 'ari', to: 'examiner', template: T.failure, payload: { message: error.message, retriable: error.retriable } })
      .catch(() => undefined);
    ctx.emit({ type: 'failed', error });
    await purgeDraft(analysisId).catch(() => undefined);
    return;
  }

  // Post-completion: metering → PayPal capture → cost ledger → draft purge (best-effort but logged)
  try {
    await finalizeBillingRun(ctx);
  } catch (e) {
    ctx.emit({ type: 'ari_line', template_id: 'ari.billing.degraded', payload: { message: String(e) } });
  }
  ctx.emit({ type: 'complete', analysis_id: analysisId });
}

async function loadRow(id: string) {
  const r = await opsQ<import('../store/db.js').AnalysisRow>('SELECT * FROM analyses WHERE id = $1', [id]);
  return r.rows[0] ?? null;
}

/** Escrow-style authorization of MAX_RUN_FEE before any work (marketplace PayPal contract). */
async function authorizeFee(ctx: RunContext): Promise<void> {
  const billing = await getBilling(ctx.analysis.id);
  if (!billing || billing.state !== 'pending') return;
  const listing = await getListing();
  const max = Number(listing?.max_run_fee ?? config().MAX_RUN_FEE);
  try {
    const auth = await paypalAuthorize(ctx.analysis.id, max);
    await setBillingAuthorized(ctx.analysis.id, auth.authId);
    if (auth.approvalUrl) {
      await ctx.ariLine('ari.billing.approval', { url: auth.approvalUrl, max });
    }
  } catch (e) {
    // PayPal unreachable → run must still work (billing marked, capture attempted later)
    await ctx.ariLine('ari.billing.degraded', { message: `authorize failed: ${String(e)}` });
  }
}

async function releaseHold(analysisId: string): Promise<void> {
  const billing = await getBilling(analysisId);
  if (!billing?.paypal_auth_id) return;
  await voidAuthorization(billing.paypal_auth_id, isMock());
  await opsQ(
    `UPDATE billing_records SET state = 'voided', price = 0, updated_at = now() WHERE analysis_id = $1 AND state = 'authorized'`,
    [analysisId],
  );
}

/**
 * Task-hour metering (guarantee #3): price = RUNTIME_RATE × billable minutes,
 * clamped [MIN_RUN_FEE, MAX_RUN_FEE=auth amount]; tier mode uses the listing tier.
 */
async function finalizeBillingRun(ctx: RunContext): Promise<void> {
  const billing = await getBilling(ctx.analysis.id);
  if (!billing) return;
  const started = ctx.analysis.started_at ?? ctx.analysis.created_at;
  const seconds = Math.max(1, Math.round((Date.now() - new Date(started).getTime()) / 1000));

  const listing = await getListing();
  const tier =
    billing.mode === 'tier'
      ? (listing?.tiers?.find((t) => t.name === (billing.tier_name ?? 'Standard')) ?? listing?.tiers?.[0])
      : undefined;

  const price = computePrice(seconds, {
    mode: billing.mode,
    rate: Number(billing.rate ?? listing?.runtime_rate ?? config().RUNTIME_RATE),
    minFee: Number(listing?.min_run_fee ?? config().MIN_RUN_FEE),
    maxFee: Number(listing?.max_run_fee ?? config().MAX_RUN_FEE),
    tierName: tier?.name,
    tierPrice: tier?.price,
  });

  const cap = await paypalCapture(billing.paypal_auth_id ?? '', price, isMock());
  const state: 'captured' | 'partial_captured' = cap.state === 'captured' ? 'captured' : 'partial_captured';
  await finalizeBilling(ctx.analysis.id, seconds, price, state, cap.captureId);

  const usage = ctx.usage.total();
  await recordRunCost(ctx.analysis.id, {
    tokensIn: usage.tokensIn,
    tokensOut: usage.tokensOut,
    bigqueryBytes: lastBytesProcessed,
    connectorCalls: ctx.connectorCalls,
    estCostUsd: config().FREE_MODE ? 0 : Math.round((usage.tokensIn / 1e6) * 0.15 + (usage.tokensOut / 1e6) * 0.6) / 1000,
  });

  await mergeResult(ctx.analysis.id, {
    billing: {
      mode: billing.mode,
      billable_seconds: seconds,
      price,
      currency: 'USD',
      state,
      paypal: cap.state === 'captured' ? 'captured' : 'uncaptured',
      rate: Number(billing.rate ?? 0),
    },
    economics: { llm_tokens_in: usage.tokensIn, llm_tokens_out: usage.tokensOut, bigquery_bytes: lastBytesProcessed },
  });

  await purgeDraft(ctx.analysis.id);
  await ctx.ariLine('ari.done', { seconds, price, state });
}
