import { DEFAULT_JOB_TTL_MS, type JobStore, type StoredJob } from "../jobstore.js";

/** The slice of a Redis client we need. Works as-is with `ioredis` and `redis` (node-redis v4+). */
export interface RedisLike {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<unknown>;
  expire(key: string, seconds: number): Promise<unknown>;
}

export interface RedisJobStoreOptions {
  /** Key prefix (default: "catelog:job:"). */
  prefix?: string;
  /** How long jobs stay readable (default: 1h). */
  ttlMs?: number;
}

/**
 * Redis-backed job store. Bring your own client; the SDK adds no Redis dependency.
 *
 * @example
 * ```ts
 * import Redis from "ioredis";
 * createAgent({ ..., jobStore: new RedisJobStore(new Redis(process.env.REDIS_URL)) });
 * ```
 */
export class RedisJobStore implements JobStore {
  private readonly prefix: string;
  private readonly ttlSeconds: number;

  constructor(private readonly client: RedisLike, options: RedisJobStoreOptions = {}) {
    this.prefix = options.prefix ?? "catelog:job:";
    this.ttlSeconds = Math.max(1, Math.ceil((options.ttlMs ?? DEFAULT_JOB_TTL_MS) / 1000));
  }

  async get(runId: string): Promise<StoredJob | undefined> {
    const raw = await this.client.get(this.prefix + runId);
    return raw ? (JSON.parse(raw) as StoredJob) : undefined;
  }

  async set(job: StoredJob): Promise<void> {
    const key = this.prefix + job.runId;
    await this.client.set(key, JSON.stringify(job));
    await this.client.expire(key, this.ttlSeconds);
  }
}
