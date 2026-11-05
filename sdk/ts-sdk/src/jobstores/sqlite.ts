import { DEFAULT_JOB_TTL_MS, type JobStore, type StoredJob } from "../jobstore.js";

export interface SqliteJobStoreOptions {
  /** Database file path (default: "./catelog-jobs.db"). Use ":memory:" for tests. */
  path?: string;
  /** How long jobs are kept (default: 1h). */
  ttlMs?: number;
}

interface Db {
  exec(sql: string): void;
  prepare(sql: string): { run(...args: unknown[]): unknown; get(...args: unknown[]): any };
  close(): void;
}

/**
 * SQLite-backed job store using Node's built-in `node:sqlite` (Node 22.5+, no extra dependency).
 * Survives restarts when the file lives on a persistent volume.
 */
export class SqliteJobStore implements JobStore {
  private db?: Db;
  private readonly path: string;
  private readonly ttlMs: number;
  private lastSweep = 0;

  constructor(options: SqliteJobStoreOptions = {}) {
    this.path = options.path ?? "./catelog-jobs.db";
    this.ttlMs = options.ttlMs ?? DEFAULT_JOB_TTL_MS;
  }

  private async open(): Promise<Db> {
    if (this.db) return this.db;
    const specifier = "node:sqlite";
    let mod: any;
    try {
      mod = await import(specifier);
    } catch {
      throw new Error(
        "SqliteJobStore needs Node.js 22.5+ (node:sqlite). Use RedisJobStore or a custom JobStore instead."
      );
    }
    const db: Db = new mod.DatabaseSync(this.path);
    db.exec(
      "CREATE TABLE IF NOT EXISTS catelog_jobs (run_id TEXT PRIMARY KEY, created_at INTEGER NOT NULL, data TEXT NOT NULL)"
    );
    this.db = db;
    return db;
  }

  async get(runId: string): Promise<StoredJob | undefined> {
    const db = await this.open();
    const row = db.prepare("SELECT data FROM catelog_jobs WHERE run_id = ?").get(runId);
    return row ? (JSON.parse(row.data) as StoredJob) : undefined;
  }

  async set(job: StoredJob): Promise<void> {
    const db = await this.open();
    db.prepare("INSERT OR REPLACE INTO catelog_jobs (run_id, created_at, data) VALUES (?, ?, ?)").run(
      job.runId,
      job.createdAt,
      JSON.stringify(job)
    );
    const now = Date.now();
    if (now - this.lastSweep > 300_000) {
      this.lastSweep = now;
      db.prepare("DELETE FROM catelog_jobs WHERE created_at < ?").run(now - this.ttlMs);
    }
  }

  async close(): Promise<void> {
    this.db?.close();
    this.db = undefined;
  }
}
