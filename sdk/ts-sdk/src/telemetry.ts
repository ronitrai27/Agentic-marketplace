import type { AgentLogger, AgentMetric, TelemetryData } from "./types.js";
import { resolveUsageTelemetry, type UsageTracker } from "./usage.js";

// ─────────────────────────────────────────────────
//  Layer 1: Universal Base Telemetry (Automatic)
// ─────────────────────────────────────────────────
//  Collected for ALL agents regardless of framework:
//  - execution duration (ms)
//  - input & output payload sizes (bytes)
//  - chunks streamed count
//  - final task state
//  - error codes if failed
// ─────────────────────────────────────────────────

export interface TelemetryCollector {
  /** Merge base metrics into telemetry payload */
  finalize: (overrides?: Partial<TelemetryData>) => TelemetryData;
  /** Record a custom metric */
  record: (name: string, value: number) => void;
  /** Get the metric helper for the execution context */
  getMetricHelper: () => AgentMetric;
  /** Get all recorded metrics */
  getMetrics: () => Record<string, number>;
}

export function createTelemetryCollector(opts: {
  inputBytes: number;
  /** Models / tokens / cost captured during the run (spans, callbacks, ctx.usage). */
  tracker?: UsageTracker;
}): TelemetryCollector {
  const metrics = new Map<string, number>();
  let chunksStreamed = 0;

  const record = (name: string, value: number): void => {
    metrics.set(name, (metrics.get(name) ?? 0) + value);
  };

  const metricHelper: AgentMetric = {
    count: (name: string, value?: number) => record(name, value ?? 1),
    gauge: (name: string, value: number) => metrics.set(name, value),
    timing: (name: string, durationMs: number) => record(name, durationMs),
  };

  return {
    record,
    getMetricHelper: () => metricHelper,
    getMetrics: () => Object.fromEntries(metrics),

    finalize(overrides?: Partial<TelemetryData>): TelemetryData {
      const usage = resolveUsageTelemetry(overrides, opts.tracker);
      const base: Partial<TelemetryData> = { ...overrides };
      if (usage.models) {
        // One source of truth: drop the adapter's flat fields so source and numbers never disagree
        delete base.llm_tokens;
        delete base.model_used;
        delete base.cost_usd;
        delete base.cost_source;
      }
      return {
        input_bytes: opts.inputBytes,
        chunks_streamed: chunksStreamed,
        ...base,
        ...usage,
        // Merge framework-specific from overrides if present
        framework: {
          ...overrides?.framework,
          custom_metrics: Object.fromEntries(metrics),
        },
      };
    },
  };
}

// ─────────────────────────────────────────────────
//  Structured Logger
// ─────────────────────────────────────────────────

const LOG_COLORS = {
  info: "\x1b[36m",    // cyan
  warn: "\x1b[33m",    // yellow
  error: "\x1b[31m",   // red
  debug: "\x1b[90m",   // gray
  reset: "\x1b[0m",
};

export function createLogger(runId: string): AgentLogger {
  const log = (level: keyof typeof LOG_COLORS, message: string, data?: Record<string, unknown>) => {
    if (level === "debug" && process.env.NODE_ENV === "production") return;

    const color = LOG_COLORS[level] || LOG_COLORS.info;
    const ts = new Date().toISOString();
    const prefix = `${color}[${level.toUpperCase()}]${LOG_COLORS.reset}`;
    const runTag = `\x1b[90m[${runId}]\x1b[0m`;

    if (data && Object.keys(data).length > 0) {
      console.log(`${prefix} ${runTag} ${message}`, data);
    } else {
      console.log(`${prefix} ${runTag} ${message}`);
    }
  };

  return {
    info: (msg, data) => log("info", msg, data),
    warn: (msg, data) => log("warn", msg, data),
    error: (msg, data) => log("error", msg, data),
    debug: (msg, data) => log("debug", msg, data),
  };
}

// ─────────────────────────────────────────────────
//  Layer 2: Background Telemetry Reporter
//  Fire-and-forget — NEVER fails agent execution
// ─────────────────────────────────────────────────

export interface TelemetryReporterOptions {
  /** Telemetry endpoint URL. Auto-reads CATELOG_TELEMETRY_URL. */
  endpoint?: string;
  /** Max time to wait for telemetry POST in ms (default: 3000) */
  timeoutMs?: number;
  /** Disable telemetry reporting entirely */
  disabled?: boolean;
}

export class TelemetryReporter {
  private endpoint?: string;
  private timeoutMs: number;
  private disabled: boolean;

  constructor(options: TelemetryReporterOptions = {}) {
    this.endpoint = options.endpoint || process.env.CATELOG_TELEMETRY_URL;
    this.timeoutMs = options.timeoutMs ?? 3_000;
    this.disabled = options.disabled ?? (process.env.CATELOG_TELEMETRY_DISABLED === "true");
  }

  /**
   * Report telemetry in the background. This is completely async and
   * will NEVER throw or block the agent's response.
   */
  public report(data: {
    agentId: string;
    runId: string;
    status: string;
    telemetry: TelemetryData;
    timestamp: number;
  }): void {
    if (this.disabled || !this.endpoint) return;

    // Fire-and-forget with silent catch
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    fetch(this.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
      signal: controller.signal,
    })
      .catch(() => {
        // Silently ignore — telemetry failures NEVER affect agent execution
      })
      .finally(() => clearTimeout(timer));
  }
}
