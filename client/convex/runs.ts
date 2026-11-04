import { internalMutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { v } from "convex/values";

const DEFAULT_TIMEOUT_S = 600;
const MAX_TIMEOUT_S = 4 * 3600;
/** A run older than its timeout plus this no longer holds a concurrency slot (worker lost, etc.). */
const SLOT_GRACE_MS = 60_000;
/** Per-user cap for signed-in (no key) callers, until wallets decide it. */
const SESSION_RATE_PER_MIN = 30;

const TERMINAL = new Set(["succeeded", "failed", "cancelled"]);

/**
 * Fixed one-minute window counter, shared with API-key limiting (same table, namespaced id).
 * Returns seconds to wait when the limit is hit, otherwise null and the hit is counted.
 */
async function bumpWindow(ctx: MutationCtx, id: string, limit: number): Promise<number | null> {
  const now = Date.now();
  const windowMinute = Math.floor(now / 60_000);
  const row = await ctx.db
    .query("api_key_rate_windows")
    .withIndex("by_keyId_window", (q) => q.eq("keyId", id).eq("windowMinute", windowMinute))
    .first();
  if (row) {
    if (row.count >= limit) return Math.max(1, Math.ceil(((windowMinute + 1) * 60_000 - now) / 1000));
    await ctx.db.patch(row._id, { count: row.count + 1 });
  } else {
    await ctx.db.insert("api_key_rate_windows", {
      keyId: id,
      windowMinute,
      count: 1,
      expiresAt: (windowMinute + 2) * 60_000,
    });
  }
  return null;
}

type Rejection = { ok: false; status: number; code: string; message: string; retryAfterSec?: number };

/**
 * The gateway's admission gate. One transaction, so the concurrency check and the insert can't race:
 * agent lookup, session rate limit, the agent's own SDK limits, then the `runs` row.
 */
export const admit = internalMutation({
  args: {
    slug: v.string(),
    userId: v.string(),
    source: v.union(v.literal("key"), v.literal("session")),
    keyId: v.optional(v.id("creator_api_keys")),
    inputJson: v.string(),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ ok: true; runId: string; timeoutSeconds: number } | Rejection> => {
    const agent = await ctx.db
      .query("agents")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .first();
    if (!agent || agent.status === "archived" || agent.status === "suspended") {
      return { ok: false, status: 404, code: "AGENT_NOT_FOUND", message: "Agent not found" };
    }
    if (agent.status === "paused") {
      return { ok: false, status: 503, code: "AGENT_PAUSED", message: "Agent is paused" };
    }

    if (args.source === "session") {
      const wait = await bumpWindow(ctx, `user:${args.userId}`, SESSION_RATE_PER_MIN);
      if (wait !== null) {
        return { ok: false, status: 429, code: "RATE_LIMITED", message: "Too many requests", retryAfterSec: wait };
      }
    }

    const caps = agent.capabilities;
    const timeoutSeconds = Math.min(caps?.max_timeout_seconds ?? DEFAULT_TIMEOUT_S, MAX_TIMEOUT_S);

    // Respect the limits the creator set in their SDK (`limits.rateLimit`, `limits.maxConcurrent`)
    if (caps?.rate_limit_per_min) {
      const wait = await bumpWindow(ctx, `agent:${agent._id}`, caps.rate_limit_per_min);
      if (wait !== null) {
        return { ok: false, status: 429, code: "AGENT_RATE_LIMITED", message: "Agent is receiving too many requests", retryAfterSec: wait };
      }
    }
    if (caps?.max_concurrent) {
      const cutoff = Date.now() - (timeoutSeconds * 1000 + SLOT_GRACE_MS);
      let active = 0;
      for (const status of ["queued", "running"] as const) {
        const rows = await ctx.db
          .query("runs")
          .withIndex("by_agent_status", (q) => q.eq("agentId", agent._id).eq("status", status))
          .order("desc")
          .take(caps.max_concurrent);
        active += rows.filter((r) => r.createdAt > cutoff).length;
      }
      if (active >= caps.max_concurrent) {
        return { ok: false, status: 429, code: "SERVER_BUSY", message: "Agent is at max concurrency", retryAfterSec: 5 };
      }
    }

    const runId = await ctx.db.insert("runs", {
      agentId: agent._id,
      userId: args.userId,
      source: args.source,
      keyId: args.keyId,
      status: "queued",
      inputJson: args.inputJson,
      timeoutSeconds,
      createdAt: Date.now(),
    });
    return { ok: true, runId, timeoutSeconds };
  },
});

/** Called by the gateway (start failed) and by the worker (via /worker/run-status). Terminal states stick. */
export const setStatus = internalMutation({
  args: {
    runId: v.id("runs"),
    status: v.union(v.literal("running"), v.literal("succeeded"), v.literal("failed"), v.literal("cancelled")),
    workflowId: v.optional(v.string()),
    error: v.optional(v.object({ code: v.string(), message: v.string() })),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run) return { ok: false as const, reason: "not_found" };
    if (TERMINAL.has(run.status)) return { ok: false as const, reason: "already_finished" };

    const now = Date.now();
    await ctx.db.patch(args.runId, {
      status: args.status,
      ...(args.workflowId ? { workflowId: args.workflowId } : {}),
      ...(args.error ? { error: args.error } : {}),
      ...(args.status === "running" ? { startedAt: now } : {}),
      ...(TERMINAL.has(args.status) ? { finishedAt: now } : {}),
    });
    return { ok: true as const };
  },
});
