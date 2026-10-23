import { randomUUID } from "node:crypto";
import type {
  AgentExecutionContext,
  AgentStream,
  NeedInputResult,
  NEED_INPUT_SYMBOL,
} from "./types.js";
import { createLogger, createTelemetryCollector, type TelemetryCollector } from "./telemetry.js";

// ─────────────────────────────────────────────────
//  In-Memory Session Store (Multi-Turn Conversations)
// ─────────────────────────────────────────────────

const sessionStore = new Map<string, { data: Record<string, unknown>; expiresAt: number }>();
const SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes default

/** Periodic cleanup of expired sessions */
let cleanupTimer: NodeJS.Timeout | undefined;
function ensureCleanupTimer(): void {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of sessionStore.entries()) {
      if (entry.expiresAt < now) sessionStore.delete(key);
    }
  }, 60_000); // Every 60s
  // Don't block process exit
  if (cleanupTimer.unref) cleanupTimer.unref();
}

function getOrCreateSession(sessionId: string): Record<string, unknown> {
  ensureCleanupTimer();
  const existing = sessionStore.get(sessionId);
  if (existing) {
    existing.expiresAt = Date.now() + SESSION_TTL_MS; // Refresh TTL
    return existing.data;
  }
  const data: Record<string, unknown> = {};
  sessionStore.set(sessionId, { data, expiresAt: Date.now() + SESSION_TTL_MS });
  return data;
}

// ─────────────────────────────────────────────────
//  Build Execution Context
// ─────────────────────────────────────────────────

export interface BuildContextOptions<TInput> {
  runId: string;
  input: TInput;
  stream: AgentStream;
  signal: AbortSignal;
  metadata?: Record<string, unknown>;
  deadlineMs?: number;
  resumeToken?: string;
  inputBytes: number;
}

export interface BuiltContext<TInput> {
  ctx: AgentExecutionContext<TInput>;
  telemetryCollector: TelemetryCollector;
}

export function buildExecutionContext<TInput>(
  options: BuildContextOptions<TInput>
): BuiltContext<TInput> {
  const {
    runId,
    input,
    stream,
    signal,
    metadata,
    deadlineMs,
    resumeToken,
    inputBytes,
  } = options;

  // Logger
  const log = createLogger(runId);

  // Telemetry collector
  const telemetryCollector = createTelemetryCollector({ inputBytes });
  const metric = telemetryCollector.getMetricHelper();

  // Session (keyed by session_id from metadata, or runId as fallback)
  const sessionId = (metadata?.session_id as string) || runId;
  const sessionData = getOrCreateSession(sessionId);

  // needInput helper
  const NeedInputSym: typeof NEED_INPUT_SYMBOL = Symbol.for("catelog.needInput") as any;
  const needInput = (opts: {
    prompt: string;
    schema?: Record<string, unknown>;
    continuation?: boolean;
  }): NeedInputResult => {
    const token = `resume_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
    // Persist session data so it survives the resume
    sessionStore.set(sessionId, {
      data: { ...sessionData, _resumeToken: token, _needInputOpts: opts },
      expiresAt: Date.now() + SESSION_TTL_MS,
    });

    return {
      [NeedInputSym]: true,
      prompt: opts.prompt,
      schema: opts.schema,
      continuation: opts.continuation,
    } as NeedInputResult;
  };

  const ctx: AgentExecutionContext<TInput> = {
    runId,
    input,
    stream,
    signal,
    log,
    metric,
    metadata,
    deadlineMs,
    resumeToken,
    needInput,
    session: {
      get: <T = unknown>(key: string): T | undefined => sessionData[key] as T | undefined,
      set: (key: string, value: unknown): void => {
        sessionData[key] = value;
      },
      getAll: (): Record<string, unknown> => ({ ...sessionData }),
    },
  };

  return { ctx, telemetryCollector };
}
