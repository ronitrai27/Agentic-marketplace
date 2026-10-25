/**
 * Workflow execution context (LlamaIndex-style staged flow: ingest → retrieve → chart → score).
 * One context object per run; every agent utterance goes through say()/ariLine() so it is
 * both persisted (Team Rail) and streamed (SSE) — the LLM never writes free narration.
 */
import type { ZodType, ZodTypeDef } from 'zod';
import type { SseEvent, AgentRole } from '../lib/events.js';
import { bus } from '../lib/events.js';
import type { SourceStatus, RankedCandidate } from '../connectors/index.js';
import type { AnalysisRow, AnalysisStatus, ReferenceRow } from '../store/db.js';
import { advanceStatus, appendAgentMessage } from '../store/db.js';
import type { LlmUsage } from '../llm/chain.js';

export interface RunContext {
  analysis: AnalysisRow;
  draftText: string;
  usage: { add: (u: LlmUsage) => void; total: () => LlmUsage };
  connectorCalls: Record<string, number>;
  statuses: SourceStatus[];
  refs: ReferenceRow[];
  candidates: RankedCandidate[];
  refined: boolean;
  chartMode: 'llm' | 'lexical';
  status: AnalysisStatus;

  emit: (ev: SseEvent) => void;
  say: (msg: { from: AgentRole; to: AgentRole; template: string; payload: Record<string, unknown> }) => Promise<void>;
  ariLine: (template: string, payload?: Record<string, unknown>) => Promise<void>;
  progress: (label: string, done: number, total: number) => void;
  stage: (
    to: AnalysisStatus,
    stageName: string,
    extra?: { score?: number; verdict?: string; result?: unknown },
  ) => Promise<void>;
}

/** Fixed template ids (FEATURES F13): templates are bound to data, never LLM prose. */
export const T = {
  intakeConfirmed: 'ari.intake.confirmed',
  ingestSplit: 'ari.ingest.split',
  ingestProvisional: 'ari.ingest.provisional',
  queryPlan: 'scout.query.plan',
  sourcesReport: 'scout.report.sources',
  familyMerge: 'clerk.family.merge',
  searchResults: 'examiner.search.results',
  chartStart: 'cartographer.chart.start',
  cell: 'cartographer.cell',
  refinement: 'cartographer.refinement',
  chartResult: 'examiner.chart.result',
  redFlags: 'examiner.redflags',
  score: 'ari.score',
  coverage: 'ari.coverage',
  done: 'ari.complete',
  failure: 'ari.failed',
} as const;

export function makeContext(analysis: AnalysisRow): RunContext {
  const ctx: RunContext = {
    analysis,
    draftText: analysis.draft_text ?? '',
    usage: { add: () => undefined, total: () => ({ tokensIn: 0, tokensOut: 0 }) },
    connectorCalls: {},
    statuses: [],
    refs: [],
    candidates: [],
    refined: false,
    chartMode: 'lexical',
    status: analysis.status,

    emit: (ev) => bus.emit(analysis.id, ev),

    say: async (msg) => {
      const seq = await appendAgentMessage(analysis.id, msg);
      ctx.emit({
        type: 'agent_msg',
        seq,
        from: msg.from,
        to: msg.to,
        template_id: msg.template,
        payload: msg.payload,
      });
    },

    ariLine: async (template, payload = {}) => {
      ctx.emit({ type: 'ari_line', template_id: template, payload });
    },

    progress: (label, done, total) => {
      ctx.emit({ type: 'progress', label, done, total });
    },

    stage: async (to, stageName, extra) => {
      const ok = await advanceStatus(analysis.id, [ctx.status], to, stageName, extra);
      if (!ok) throw new Error(`status race: expected ${ctx.status} → ${to} on ${analysis.id}`);
      ctx.status = to;
      ctx.emit({ type: 'stage', status: to, stage: stageName });
    },
  };
  return ctx;
}

/** Helper: run an LLM structured call and fold usage into the run's cost ledger. */
export async function trackedChat<T>(
  ctx: RunContext,
  opts: { system: string; user: string; schema: ZodType<T, ZodTypeDef, any>; temperature?: number },
): Promise<T | null> {
  try {
    const { chatJSON } = await import('../llm/chain.js');
    const r = await chatJSON(opts);
    ctx.usage.add(r.usage);
    return r.data;
  } catch {
    return null; // offline / free-tier exhausted → caller uses deterministic fallback
  }
}
