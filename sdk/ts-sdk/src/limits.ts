import type { IncomingMessage } from "node:http";

// ─────────────────────────────────────────────────
//  Optional limits — everything is OFF unless set
// ─────────────────────────────────────────────────

export interface LimitsConfig {
  /** Max simultaneous `/execute` runs. Extra requests get 429 SERVER_BUSY. */
  maxConcurrent?: number;
  /** Max request body size in bytes. Larger requests get 413 PAYLOAD_TOO_LARGE. */
  maxBodyBytes?: number;
  /** Per-client fixed-window rate limit on `/execute`. */
  rateLimit?: {
    /** Max requests per window. */
    max: number;
    /** Window length in ms (default: 60_000). */
    windowMs?: number;
  };
  /** Read the client IP from `X-Forwarded-For` (enable only behind a trusted proxy). */
  trustProxy?: boolean;
}

export class BodyTooLargeError extends Error {
  constructor(public readonly limit: number) {
    super(`Request body exceeds ${limit} bytes`);
    this.name = "BodyTooLargeError";
  }
}

export interface LimitRejection {
  status: number;
  code: string;
  message: string;
  retryAfterSec?: number;
}

export class LimitGuard {
  private active = 0;
  private readonly hits = new Map<string, { count: number; resetAt: number }>();

  constructor(private readonly cfg: LimitsConfig = {}) {}

  get maxBodyBytes(): number | undefined {
    return this.cfg.maxBodyBytes;
  }

  /**
   * Returns a rejection if the request must be refused. Otherwise it reserves a
   * concurrency slot, and the caller MUST call `release()` when the run ends.
   */
  admit(req: IncomingMessage): LimitRejection | undefined {
    const rl = this.cfg.rateLimit;
    if (rl) {
      const now = Date.now();
      const windowMs = rl.windowMs ?? 60_000;
      const key = this.clientKey(req);
      let hit = this.hits.get(key);
      if (!hit || hit.resetAt <= now) {
        if (this.hits.size > 10_000) this.prune(now);
        hit = { count: 0, resetAt: now + windowMs };
        this.hits.set(key, hit);
      }
      if (hit.count >= rl.max) {
        return {
          status: 429,
          code: "RATE_LIMITED",
          message: "Too many requests",
          retryAfterSec: Math.max(1, Math.ceil((hit.resetAt - now) / 1000)),
        };
      }
      hit.count += 1;
    }

    const max = this.cfg.maxConcurrent;
    if (max !== undefined && this.active >= max) {
      return { status: 429, code: "SERVER_BUSY", message: "Agent is at max concurrency", retryAfterSec: 1 };
    }
    this.active += 1;
    return undefined;
  }

  release(): void {
    if (this.active > 0) this.active -= 1;
  }

  private clientKey(req: IncomingMessage): string {
    if (this.cfg.trustProxy) {
      const fwd = req.headers["x-forwarded-for"];
      const first = (Array.isArray(fwd) ? fwd[0] : fwd)?.split(",")[0]?.trim();
      if (first) return first;
    }
    return req.socket.remoteAddress ?? "unknown";
  }

  private prune(now: number): void {
    for (const [k, v] of this.hits) if (v.resetAt <= now) this.hits.delete(k);
  }
}
