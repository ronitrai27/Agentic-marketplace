import type { StructuredError, TaskEventRecord, TelemetryData } from "./types.js";

// ─────────────────────────────────────────────────
//  Job Store — pluggable persistence for async jobs
// ─────────────────────────────────────────────────

/** Serializable snapshot of an async (`mode: "async"`) job. */
export interface StoredJob<TOutput = any> {
  runId: string;
  status: "working" | "completed" | "failed";
  output?: TOutput;
  error?: StructuredError;
  telemetry?: TelemetryData;
  durationMs?: number;
  createdAt: number;
  /** Last time the owning process touched this job (heartbeat while working). */
  updatedAt: number;
  /** Buffered live events (capped). */
  events?: TaskEventRecord[];
  currentStep?: string;
  progressPct?: number;
  lastSeq?: number;
}

/**
 * Storage backend for async jobs. Implement this to plug in any database.
 * Built-ins: `MemoryJobStore` (default), `RedisJobStore`, `SqliteJobStore`.
 */
export interface JobStore {
  get(runId: string): Promise<StoredJob | undefined>;
  set(job: StoredJob): Promise<void>;
  /** Release timers / handles. Called by `agent.shutdown()`. Never closes a client you passed in. */
  close?(): Promise<void>;
}

export const DEFAULT_JOB_TTL_MS = 3_600_000;

// ─────────────────────────────────────────────────
//  MemoryJobStore (default — same behaviour as before)
// ─────────────────────────────────────────────────

export class MemoryJobStore implements JobStore {
  private readonly jobs = new Map<string, StoredJob>();
  private readonly timer: NodeJS.Timeout;

  constructor(private readonly ttlMs = DEFAULT_JOB_TTL_MS) {
    this.timer = setInterval(() => this.sweep(), 300_000);
    this.timer.unref();
  }

  async get(runId: string): Promise<StoredJob | undefined> {
    return this.jobs.get(runId);
  }

  async set(job: StoredJob): Promise<void> {
    this.jobs.set(job.runId, job);
  }

  async close(): Promise<void> {
    clearInterval(this.timer);
  }

  private sweep(): void {
    const cutoff = Date.now() - this.ttlMs;
    for (const [id, job] of this.jobs) {
      if (job.createdAt < cutoff) this.jobs.delete(id);
    }
  }
}
