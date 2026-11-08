import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { components, internal } from "./_generated/api";
import { ConvexError, v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { escrowCredits, getCredits, setCredits } from "./escrow";
import { announceRunEnd } from "./chatRuns";
import { chargeMicrosFor, microsToCredits, runQuote, type PlanMicros } from "../src/lib/agent-display";

const DEFAULT_TIMEOUT_S = 600;
const MAX_TIMEOUT_S = 4 * 3600;
/** A run older than its timeout plus this no longer holds a concurrency slot (worker lost, etc.). */
const SLOT_GRACE_MS = 60_000;
/** Extra time past the timeout before the marketplace itself aborts a run. */
const REAP_GRACE_MS = 30_000;
/** Per-user cap for signed-in (no key) callers on the /v1/runs gateway. */
const SESSION_RATE_PER_MIN = 30;
/** A payment hold with no input sent is released after this long. */
const HOLD_TTL_MS = 15 * 60_000;
/** Failed /health checks in a row (across runs) before an agent is paused. */
const HEALTH_FAILURE_LIMIT = 3;
const MAX_INPUT_CHARS = 256_000;
const MAX_EVENT_CHARS = 32_000;
const MAX_OUTPUT_CHARS = 400_000;
const MAX_EVENTS_PER_RUN = 1000;
const EVENTS_SHOWN = 500;

const TERMINAL = new Set(["succeeded", "failed", "cancelled"]);
const ALWAYS_KEPT = new Set(["task.completed", "task.failed", "schema.check", "run.note"]);

type Rejection = { ok: false; status: number; code: string; message: string; retryAfterSec?: number };

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

function timeoutFor(agent: Doc<"agents">): number {
  return Math.min(agent.capabilities?.max_timeout_seconds ?? DEFAULT_TIMEOUT_S, MAX_TIMEOUT_S);
}

/** The limits a creator set in their SDK (`limits.rateLimit`, `limits.maxConcurrent`), enforced at the gateway. */
async function checkAgentLimits(ctx: MutationCtx, agent: Doc<"agents">, timeoutSeconds: number): Promise<Rejection | null> {
  const caps = agent.capabilities;
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
  return null;
}

async function latestPlan(ctx: QueryCtx | MutationCtx, agentId: Id<"agents">): Promise<PlanMicros | null> {
  const row = await ctx.db
    .query("agent_pricing")
    .withIndex("by_agent_created", (q) => q.eq("agentId", agentId))
    .order("desc")
    .first();
  return (row?.plan as PlanMicros | undefined) ?? null;
}

/**
 * The creator's secret keys the worker may sign with, newest first, the one this agent last worked with in front.
 * Sealed copies only: Convex cannot read them. The agent's own `CATELOG_SECRET_KEY` is one of these.
 */
async function signingKeysFor(ctx: QueryCtx, agent: Doc<"agents">): Promise<Array<{ keyId: string; sealed: string }>> {
  const keys = await ctx.db
    .query("creator_api_keys")
    .withIndex("by_userId_status", (q) => q.eq("userId", agent.ownerId).eq("status", "active"))
    .order("desc")
    .take(10);
  const usable = keys.filter((k) => k.sealed && (!k.expiresAt || k.expiresAt > Date.now()));
  usable.sort((a, b) => Number(b._id === agent.signingKeyId) - Number(a._id === agent.signingKeyId));
  return usable.slice(0, 5).map((k) => ({ keyId: k._id as string, sealed: k.sealed! }));
}

/**
 * Tiered plans: the price depends on the option the buyer picks in the input form, so it is only known once the
 * input is sent. The option comes from the input, or from the input schema's default when the form left it out.
 */
function pickedTier(plan: PlanMicros | null, input: Record<string, unknown>, schemaJson: string) {
  if (plan?.shape !== "tiered") return null;
  let picked: unknown = input[plan.fieldKey];
  if (picked === undefined || picked === null || picked === "") {
    try {
      picked = (JSON.parse(schemaJson)?.properties?.[plan.fieldKey] as { default?: unknown } | undefined)?.default;
    } catch {
      picked = undefined;
    }
  }
  return plan.tiers.find((t) => t.value === String(picked)) ?? null;
}

async function releaseHold(ctx: MutationCtx, run: Doc<"runs">) {
  if (run.holdStatus === "held") await ctx.db.patch(run._id, { holdStatus: "released" });
}

/** Name and avatar of a caller, snapshotted onto the run when it is created. */
async function callerOf(ctx: MutationCtx, userId: string): Promise<{ callerName?: string; callerAvatar?: string }> {
  try {
    const user = await (ctx as any).runQuery(components.betterAuth.adapter.findOne, {
      model: "user",
      where: [{ field: "_id", value: userId }],
    });
    return { callerName: user?.name || user?.email || undefined, callerAvatar: user?.image || undefined };
  } catch {
    return {};
  }
}

/**
 * Trace + stats for a run that reached a final state: total time, then the agent's running counters, its daily row
 * and the per-caller daily row. Called exactly once per run (terminal states stick).
 */
async function recordOutcome(ctx: MutationCtx, run: Doc<"runs">, ok: boolean, now: number) {
  const durationMs = Math.max(0, now - (run.startedAt ?? run.createdAt));
  await ctx.db.patch(run._id, { durationMs });
  const day = new Date(now).toISOString().slice(0, 10);
  const bump = { totalRuns: 1, successRuns: ok ? 1 : 0, failedRuns: ok ? 0 : 1, totalLatencyMs: durationMs };

  const total = await ctx.db.query("agent_stats").withIndex("by_agent", (q) => q.eq("agentId", run.agentId)).first();
  if (total) {
    await ctx.db.patch(total._id, {
      totalRuns: total.totalRuns + 1,
      successRuns: total.successRuns + bump.successRuns,
      failedRuns: total.failedRuns + bump.failedRuns,
      totalLatencyMs: total.totalLatencyMs + durationMs,
      lastRunAt: now,
      updatedAt: now,
    });
  } else {
    await ctx.db.insert("agent_stats", { agentId: run.agentId, ...bump, lastRunAt: now, updatedAt: now });
  }

  const daily = await ctx.db
    .query("agent_stats_daily")
    .withIndex("by_agent_day", (q) => q.eq("agentId", run.agentId).eq("day", day))
    .first();
  if (daily) {
    await ctx.db.patch(daily._id, {
      totalRuns: daily.totalRuns + 1,
      successRuns: daily.successRuns + bump.successRuns,
      failedRuns: daily.failedRuns + bump.failedRuns,
      totalLatencyMs: daily.totalLatencyMs + durationMs,
    });
  } else {
    await ctx.db.insert("agent_stats_daily", { agentId: run.agentId, day, ...bump });
  }

  const caller = await ctx.db
    .query("agent_callers_daily")
    .withIndex("by_agent_day_user", (q) => q.eq("agentId", run.agentId).eq("day", day).eq("userId", run.userId))
    .first();
  const identity = {
    userName: run.callerName,
    userAvatar: run.callerAvatar,
    lastIp: run.clientIp,
    lastRegion: run.clientRegion,
  };
  if (caller) {
    await ctx.db.patch(caller._id, {
      ...identity,
      totalRuns: caller.totalRuns + 1,
      successRuns: caller.successRuns + bump.successRuns,
      failedRuns: caller.failedRuns + bump.failedRuns,
      totalLatencyMs: caller.totalLatencyMs + durationMs,
    });
  } else {
    await ctx.db.insert("agent_callers_daily", { agentId: run.agentId, userId: run.userId, day, ...identity, ...bump });
  }
}

/** A finished run no longer needs the buyer's uploaded files: delete them rather than keep them around. */
async function dropStoredInput(ctx: MutationCtx, run: Doc<"runs">) {
  if (!run.inputStorageId) return;
  await ctx.storage.delete(run.inputStorageId).catch(() => {});
  await ctx.db.patch(run._id, { inputStorageId: undefined });
}

// ─── Gateway (secret key / session over HTTP) ───────────────────────────────

/**
 * The /v1/runs admission gate. One transaction, so the concurrency check and the insert can't race:
 * agent lookup, session rate limit, the agent's own SDK limits, then the `runs` row.
 */
export const admit = internalMutation({
  args: {
    slug: v.string(),
    userId: v.string(),
    source: v.union(v.literal("key"), v.literal("session")),
    keyId: v.optional(v.id("creator_api_keys")),
    inputJson: v.string(),
    clientIp: v.optional(v.string()),
    clientRegion: v.optional(v.string()),
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

    const timeoutSeconds = timeoutFor(agent);
    const limited = await checkAgentLimits(ctx, agent, timeoutSeconds);
    if (limited) return limited;

    const runId = await ctx.db.insert("runs", {
      agentId: agent._id,
      userId: args.userId,
      source: args.source,
      keyId: args.keyId,
      status: "queued",
      inputJson: args.inputJson,
      timeoutSeconds,
      createdAt: Date.now(),
      clientIp: args.clientIp,
      clientRegion: args.clientRegion,
      ...(await callerOf(ctx, args.userId)),
    });
    return { ok: true, runId, timeoutSeconds };
  },
});

// ─── Human flow: hold the payment, then send the input ──────────────────────

/** Step 3 of the confirm dialog: reserve the maximum cost from the wallet and open a run that awaits its input. */
export const hold = mutation({
  args: {
    slug: v.string(),
    /** Set when the chef started this run (HITL approved): the run's end is announced in that chat. */
    chatId: v.optional(v.string()),
  },
  handler: async (ctx, { slug, chatId }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Please sign in to run an agent." });
    const userId = identity.subject;

    const agent = await ctx.db
      .query("agents")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .first();
    if (!agent || agent.status === "archived" || agent.status === "suspended") {
      throw new ConvexError({ code: "AGENT_NOT_FOUND", message: "Agent not found." });
    }
    if (agent.status === "paused") throw new ConvexError({ code: "AGENT_PAUSED", message: "This agent is paused." });

    // Reopening after closing the sheet reuses the run already holding this buyer's payment, so it is never held twice
    const open = await ctx.db
      .query("runs")
      .withIndex("by_user_created", (q) => q.eq("userId", userId))
      .order("desc")
      .take(20);
    const plan = await latestPlan(ctx, agent._id);
    // Chef runs always hold up front, the highest tier for tiered plans; the charge settles to the real tier later
    const tiered = plan?.shape === "tiered" && !chatId;
    const existing = open.find(
      (r) => r.agentId === agent._id && r.status === "awaiting_input" && (tiered || r.holdStatus === "held"),
    );
    if (existing) {
      if (chatId && existing.chatId !== chatId) await ctx.db.patch(existing._id, { chatId });
      return { runId: existing._id, holdCredits: existing.holdCredits ?? 0 };
    }

    const quote = runQuote(plan);
    if (!quote.holdMicros) throw new ConvexError({ code: "NO_PRICE", message: "This agent has no price set." });
    // Tiered (buyer flow): nothing is held yet (the option is not chosen), the wallet only has to cover the cheapest option
    const holdCredits = microsToCredits(
      tiered ? runQuote({ ...plan, tiers: [plan.tiers.reduce((a, b) => (b.priceMicros < a.priceMicros ? b : a))] }).holdMicros! : quote.holdMicros,
    );

    const available = (await getCredits(ctx, userId)) - (await escrowCredits(ctx, userId));
    if (available < holdCredits) {
      throw new ConvexError({
        code: "INSUFFICIENT_FUNDS",
        message: "Not enough credits in your wallet.",
        needed: holdCredits,
        available: Math.max(0, Math.round(available * 100) / 100),
      });
    }

    const runId = await ctx.db.insert("runs", {
      agentId: agent._id,
      userId,
      source: "session",
      status: "awaiting_input",
      inputJson: "{}",
      ...(tiered ? {} : { holdCredits, holdStatus: "held" as const }),
      timeoutSeconds: timeoutFor(agent),
      createdAt: Date.now(),
      callerName: identity.name || identity.email || undefined,
      callerAvatar: identity.pictureUrl || undefined,
      ...(chatId ? { chatId: chatId.slice(0, 64) } : {}),
    });
    await ctx.scheduler.runAfter(HOLD_TTL_MS, internal.runs.expireAwaiting, { runId });
    return { runId, holdCredits: tiered ? 0 : holdCredits };
  },
});

/** Buyer backs out before sending the input: the hold goes straight back. */
export const cancelAwaiting = mutation({
  args: { runId: v.id("runs") },
  handler: async (ctx, { runId }) => {
    const identity = await ctx.auth.getUserIdentity();
    const run = await ctx.db.get(runId);
    if (!identity || !run || run.userId !== identity.subject) throw new ConvexError({ code: "NOT_FOUND", message: "Run not found." });
    if (run.status !== "awaiting_input") return { ok: false as const };
    await releaseHold(ctx, run);
    await ctx.db.patch(runId, { status: "cancelled", finishedAt: Date.now() });
    await announceRunEnd(ctx, run, "cancelled");
    return { ok: true as const };
  },
});

export const expireAwaiting = internalMutation({
  args: { runId: v.id("runs") },
  handler: async (ctx, { runId }) => {
    const run = await ctx.db.get(runId);
    if (!run || run.status !== "awaiting_input") return;
    await releaseHold(ctx, run);
    await ctx.db.patch(runId, {
      status: "cancelled",
      finishedAt: Date.now(),
      error: { code: "HOLD_EXPIRED", message: "No input was sent in time, so the hold was released." },
    });
    await announceRunEnd(ctx, run, "cancelled", { error: "no input was sent in time" });
  },
});

/** Called by the `start` action: checks ownership, size and the agent's SDK limits, then queues the run. */
export const beginRun = internalMutation({
  args: {
    runId: v.id("runs"),
    userId: v.string(),
    inputJson: v.optional(v.string()),
    inputStorageId: v.optional(v.id("_storage")),
    /** Short top-level values of a large input (which lives in file storage), so a tiered price can be read from it. */
    pricingInputJson: v.optional(v.string()),
    clientIp: v.optional(v.string()),
    clientRegion: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ ok: true; timeoutSeconds: number; heldCredits?: number } | Rejection> => {
    const run = await ctx.db.get(args.runId);
    if (!run || run.userId !== args.userId) {
      return { ok: false, status: 404, code: "NOT_FOUND", message: "Run not found" };
    }
    if (run.status !== "awaiting_input") {
      return { ok: false, status: 409, code: "ALREADY_STARTED", message: "This run was already started or closed" };
    }
    // Inline inputs are checked here; large ones were checked by the `start` action before going to storage
    if (args.inputJson !== undefined) {
      if (args.inputJson.length > MAX_INPUT_CHARS) {
        return { ok: false, status: 413, code: "PAYLOAD_TOO_LARGE", message: "Input is too large" };
      }
      try {
        const parsed = JSON.parse(args.inputJson);
        if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
      } catch {
        return { ok: false, status: 400, code: "INVALID_INPUT", message: "Input must be a JSON object" };
      }
    } else if (!args.inputStorageId) {
      return { ok: false, status: 400, code: "INVALID_INPUT", message: "Input is missing" };
    }
    const agent = await ctx.db.get(run.agentId);
    if (!agent || agent.status !== "active") {
      return { ok: false, status: 503, code: "AGENT_PAUSED", message: "This agent is not accepting runs right now" };
    }
    const limited = await checkAgentLimits(ctx, agent, run.timeoutSeconds);
    if (limited) return limited;

    // Tiered plans are held only now, for the option the buyer chose (other plans were held when the run opened)
    let heldCredits: number | undefined;
    let holdPatch: { holdCredits: number; holdStatus: "held" } | undefined;
    if (run.holdStatus !== "held") {
      const plan = await latestPlan(ctx, agent._id);
      if (plan?.shape === "tiered") {
        let input: Record<string, unknown> = {};
        try {
          input = JSON.parse(args.inputJson ?? args.pricingInputJson ?? "{}");
        } catch {
          /* handled below: no option found */
        }
        const tier = pickedTier(plan, input, agent.inputSchemaJson);
        if (!tier) {
          return { ok: false, status: 400, code: "INVALID_INPUT", message: `Pick one of the available options for "${plan.fieldKey}".` };
        }
        const holdMicros = runQuote({ ...plan, tiers: [tier] }).holdMicros!;
        heldCredits = microsToCredits(holdMicros);
        const available = (await getCredits(ctx, run.userId)) - (await escrowCredits(ctx, run.userId));
        if (available < heldCredits) {
          return {
            ok: false,
            status: 402,
            code: "INSUFFICIENT_FUNDS",
            message: `Not enough credits for "${tier.value}". You need ${heldCredits} credits and have ${Math.max(0, Math.round(available * 100) / 100)} available.`,
          };
        }
        holdPatch = { holdCredits: heldCredits, holdStatus: "held" };
      }
    }

    await ctx.db.patch(args.runId, {
      ...holdPatch,
      status: "queued",
      inputJson: args.inputJson ?? "{}",
      ...(args.inputStorageId ? { inputStorageId: args.inputStorageId, inputLarge: true } : {}),
      clientIp: args.clientIp,
      clientRegion: args.clientRegion,
      createdAt: Date.now(),
    });
    return { ok: true, timeoutSeconds: run.timeoutSeconds, heldCredits };
  },
});

// ─── Status reporting (worker) ──────────────────────────────────────────────

/** Called by the gateway (start failed) and by the worker. Terminal states stick; failed/cancelled release the hold. */
export const setStatus = internalMutation({
  args: {
    runId: v.id("runs"),
    status: v.union(v.literal("running"), v.literal("failed"), v.literal("cancelled")),
    workflowId: v.optional(v.string()),
    error: v.optional(v.object({ code: v.string(), message: v.string() })),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run) return { ok: false as const, reason: "not_found" };
    if (TERMINAL.has(run.status)) return { ok: false as const, reason: "already_finished" };

    const now = Date.now();
    if (args.status !== "running") {
      await releaseHold(ctx, run);
      await dropStoredInput(ctx, run);
      // Only runs that reached the agent count against it, not queue/worker failures
      if (run.status === "running") await recordOutcome(ctx, run, false, now);
    }
    await ctx.db.patch(args.runId, {
      status: args.status,
      ...(args.workflowId ? { workflowId: args.workflowId } : {}),
      ...(args.error ? { error: args.error } : {}),
      ...(args.status === "running" ? { startedAt: now } : { finishedAt: now }),
    });
    if (args.status !== "running") await announceRunEnd(ctx, run, args.status, { error: args.error?.message });
    return { ok: true as const };
  },
});

/**
 * Marketplace-side deadline. A queued/running run past its agent's max timeout (plus a short grace for the worker
 * to report on its own) is failed here, so a dead worker or lost workflow can never leave it running forever.
 */
export const reapStale = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    let reaped = 0;
    for (const status of ["queued", "running"] as const) {
      const rows = await ctx.db
        .query("runs")
        .withIndex("by_status_created", (q) => q.eq("status", status))
        .take(200);
      for (const run of rows) {
        const deadline = (run.startedAt ?? run.createdAt) + run.timeoutSeconds * 1000 + REAP_GRACE_MS;
        if (status === "queued") {
          // Queued runs never started: they get the same budget from admission
          if (run.createdAt + run.timeoutSeconds * 1000 + REAP_GRACE_MS > now) continue;
        } else if (deadline > now) continue;
        await releaseHold(ctx, run);
        await dropStoredInput(ctx, run);
        if (status === "running") await recordOutcome(ctx, run, false, now);
        await ctx.db.patch(run._id, {
          status: "failed",
          finishedAt: now,
          error: { code: "TIMEOUT", message: `Run exceeded the agent's ${Math.round(run.timeoutSeconds / 60)} min limit and was stopped.` },
        });
        await announceRunEnd(ctx, run, "failed", { error: "it ran past its time limit and was stopped" });
        reaped++;
      }
    }
    return { reaped };
  },
});

/** The agent answered and its output matched the schema: charge the buyer and close the run. */
export const complete = internalMutation({
  args: { runId: v.id("runs"), outputJson: v.string() },
  handler: async (ctx, { runId, outputJson }) => {
    const run = await ctx.db.get(runId);
    if (!run) return { ok: false as const, reason: "not_found" };
    if (TERMINAL.has(run.status)) return { ok: false as const, reason: "already_finished" };

    let charged: number | undefined;
    if (run.holdStatus === "held") {
      const plan = await latestPlan(ctx, run.agentId);
      let input: unknown = {};
      let output: unknown = {};
      try {
        input = JSON.parse(run.inputJson);
        output = JSON.parse(outputJson);
      } catch {
        /* charge falls back to the hold */
      }
      const hold = run.holdCredits ?? 0;
      charged = plan ? Math.min(hold, microsToCredits(chargeMicrosFor(plan, input, output))) : hold;
      const balance = await getCredits(ctx, run.userId);
      await setCredits(ctx, run.userId, Math.max(0, balance - charged));
      await ctx.db.patch(runId, { holdStatus: "settled", chargedCredits: charged });
    }
    await dropStoredInput(ctx, run);
    const now = Date.now();
    await recordOutcome(ctx, run, true, now);
    await ctx.db.patch(runId, {
      status: "succeeded",
      finishedAt: now,
      progressPct: 100,
    });
    await ctx.db.insert("run_outputs", {
      runId,
      outputJson:
        outputJson.length > MAX_OUTPUT_CHARS
          ? JSON.stringify({ truncated: true, preview: outputJson.slice(0, MAX_OUTPUT_CHARS) })
          : outputJson,
    });
    await announceRunEnd(ctx, run, "succeeded", { charged });
    return { ok: true as const, charged };
  },
});

/** Stores what the agent emitted. Event rows are clipped and capped, so a chatty agent can't bloat the table. */
export const appendEvents = internalMutation({
  args: { runId: v.id("runs"), events: v.array(v.object({ type: v.string(), dataJson: v.string() })) },
  handler: async (ctx, { runId, events }) => {
    const run = await ctx.db.get(runId);
    if (!run) return { ok: false as const };
    const last = await ctx.db
      .query("run_events")
      .withIndex("by_run_seq", (q) => q.eq("runId", runId))
      .order("desc")
      .first();
    let seq = last?.seq ?? 0;
    const at = Date.now();
    // Latest progress percent drives the live bar in the sidebar
    for (const e of events) {
      if (e.type !== "task.progress") continue;
      try {
        const pct = Number(JSON.parse(e.dataJson)?.percent);
        if (Number.isFinite(pct) && !TERMINAL.has(run.status)) {
          await ctx.db.patch(runId, { progressPct: Math.min(100, Math.max(0, pct)) });
        }
      } catch {
        /* not JSON, ignore */
      }
    }
    for (const e of events) {
      if (seq >= MAX_EVENTS_PER_RUN && !ALWAYS_KEPT.has(e.type)) continue;
      seq += 1;
      const dataJson =
        e.dataJson.length > MAX_EVENT_CHARS
          ? JSON.stringify({ truncated: true, preview: e.dataJson.slice(0, MAX_EVENT_CHARS) })
          : e.dataJson;
      await ctx.db.insert("run_events", { runId, seq, type: e.type, dataJson, at });
    }
    return { ok: true as const };
  },
});

/** Everything the worker needs, including the agent's URL. Only reachable through the worker-secret route. */
export const contextForWorker = internalQuery({
  args: { runId: v.id("runs") },
  handler: async (ctx, { runId }) => {
    const run = await ctx.db.get(runId);
    if (!run) return null;
    const agent = await ctx.db.get(run.agentId);
    if (!agent) return null;
    const keys = await signingKeysFor(ctx, agent);
    return {
      status: run.status,
      baseUrl: agent.baseUrl,
      agentName: agent.name,
      inputJson: run.inputJson,
      inputUrl: run.inputStorageId ? await ctx.storage.getUrl(run.inputStorageId) : null,
      inputSchemaJson: agent.inputSchemaJson,
      outputSchemaJson: agent.outputSchemaJson,
      timeoutSeconds: run.timeoutSeconds,
      signingKeys: keys,
    };
  },
});

/** The worker found which of the owner's keys this agent accepts; remember it so later runs sign right first time. */
export const rememberSigningKey = internalMutation({
  args: { runId: v.id("runs"), keyId: v.id("creator_api_keys") },
  handler: async (ctx, { runId, keyId }) => {
    const run = await ctx.db.get(runId);
    const agent = run && (await ctx.db.get(run.agentId));
    const key = await ctx.db.get(keyId);
    if (!agent || !key || key.userId !== agent.ownerId) return { ok: false as const };
    if (agent.signingKeyId !== keyId) await ctx.db.patch(agent._id, { signingKeyId: keyId });
    return { ok: true as const };
  },
});

// ─── Health (used by convex/health.ts) ──────────────────────────────────────

export const agentTarget = internalQuery({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    const agent = await ctx.db
      .query("agents")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .first();
    if (!agent || agent.status === "archived" || agent.status === "suspended") return null;
    const hasKey = (await signingKeysFor(ctx, agent)).length > 0;
    return { agentId: agent._id, baseUrl: agent.baseUrl, status: agent.status, hasKey };
  },
});

export const recordHealth = internalMutation({
  args: { agentId: v.id("agents"), ok: v.boolean() },
  handler: async (ctx, { agentId, ok }) => {
    const agent = await ctx.db.get(agentId);
    if (!agent) return { paused: false };
    if (ok) {
      if (agent.healthFailures) await ctx.db.patch(agentId, { healthFailures: 0 });
      return { paused: false };
    }
    const failures = (agent.healthFailures ?? 0) + 1;
    const pause = failures >= HEALTH_FAILURE_LIMIT && agent.status === "active";
    await ctx.db.patch(agentId, {
      healthFailures: failures,
      ...(pause ? { status: "paused" as const, updatedAt: Date.now() } : {}),
    });
    return { paused: pause };
  },
});

// ─── Reads for the run sheet (owner only) ───────────────────────────────────

export const get = query({
  args: { runId: v.id("runs") },
  handler: async (ctx, { runId }) => {
    const identity = await ctx.auth.getUserIdentity();
    const run = await ctx.db.get(runId);
    if (!identity || !run || run.userId !== identity.subject) return null;
    const agent = await ctx.db.get(run.agentId);
    if (!agent) return null;
    return {
      id: run._id as string,
      status: run.status,
      error: run.error ?? null,
      createdAt: run.createdAt,
      startedAt: run.startedAt ?? null,
      finishedAt: run.finishedAt ?? null,
      timeoutSeconds: run.timeoutSeconds,
      holdCredits: run.holdCredits ?? null,
      holdStatus: run.holdStatus ?? null,
      chargedCredits: run.chargedCredits ?? null,
      inputJson: run.status === "awaiting_input" || run.inputLarge ? null : run.inputJson,
      inputLarge: run.inputLarge ?? false,
      outputJson:
        (await ctx.db.query("run_outputs").withIndex("by_run", (q) => q.eq("runId", runId)).first())?.outputJson ?? null,
      agent: {
        name: agent.name,
        slug: agent.slug,
        logoUrl: agent.logoUrl ?? null,
        inputSchemaJson: agent.inputSchemaJson,
        outputSchemaJson: agent.outputSchemaJson,
      },
    };
  },
});

export const events = query({
  args: { runId: v.id("runs") },
  handler: async (ctx, { runId }) => {
    const identity = await ctx.auth.getUserIdentity();
    const run = await ctx.db.get(runId);
    if (!identity || !run || run.userId !== identity.subject) return [];
    const rows = await ctx.db
      .query("run_events")
      .withIndex("by_run_seq", (q) => q.eq("runId", runId))
      .order("desc")
      .take(EVENTS_SHOWN);
    return rows.reverse().map((e) => ({ seq: e.seq, type: e.type, dataJson: e.dataJson, at: e.at }));
  },
});

/** The signed-in buyer's own runs of one agent, newest first. Powers the History table on the agent page. */
export const myForAgent = query({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const agent = await ctx.db
      .query("agents")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .first();
    if (!agent) return [];
    const rows = await ctx.db
      .query("runs")
      .withIndex("by_user_created", (q) => q.eq("userId", identity.subject))
      .order("desc")
      .take(100);
    return rows
      .filter((r) => r.agentId === agent._id && r.status !== "awaiting_input")
      .slice(0, 50)
      .map((r) => ({
        id: r._id as string,
        status: r.status,
        createdAt: r.createdAt,
        durationMs: r.durationMs ?? (r.finishedAt ? r.finishedAt - (r.startedAt ?? r.createdAt) : null),
        chargedCredits: r.chargedCredits ?? null,
        holdCredits: r.holdCredits ?? null,
        holdStatus: r.holdStatus ?? null,
        errorMessage: r.error?.message ?? null,
      }));
  },
});

/** The buyer's latest runs, with their agent. Drives the header pill, the Run button state and the toasts. */
export const myRecent = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const since = Date.now() - 24 * 3600_000;
    const rows = await ctx.db
      .query("runs")
      .withIndex("by_user_created", (q) => q.eq("userId", identity.subject).gte("createdAt", since))
      .order("desc")
      .take(15);
    const out = [];
    for (const r of rows) {
      const agent = await ctx.db.get(r.agentId);
      if (!agent) continue;
      out.push({
        id: r._id as string,
        status: r.status,
        agentName: agent.name,
        agentSlug: agent.slug,
        logoUrl: agent.logoUrl ?? null,
        progressPct: r.progressPct ?? null,
        createdAt: r.createdAt,
        startedAt: r.startedAt ?? null,
        chargedCredits: r.chargedCredits ?? null,
        errorMessage: r.error?.message ?? null,
        errorCode: r.error?.code ?? null,
        holdCredits: r.holdCredits ?? null,
        holdStatus: r.holdStatus ?? null,
      });
    }
    return out;
  },
});

/** All of the buyer's runs, newest first and paged, for the /space/runs table. */
export const myAll = query({
  args: {
    filter: v.union(v.literal("all"), v.literal("succeeded"), v.literal("failed"), v.literal("active"), v.literal("cancelled")),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, { filter, paginationOpts }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return { page: [], isDone: true, continueCursor: "" };
    const res = await ctx.db
      .query("runs")
      .withIndex("by_user_created", (q) => q.eq("userId", identity.subject))
      .order("desc")
      .filter((q) =>
        filter === "all"
          ? q.neq(q.field("status"), "awaiting_input")
          : filter === "active"
            ? q.or(q.eq(q.field("status"), "queued"), q.eq(q.field("status"), "running"))
            : q.eq(q.field("status"), filter),
      )
      .paginate(paginationOpts);
    const agents = new Map<string, Doc<"agents"> | null>();
    const page = [];
    for (const r of res.page) {
      if (!agents.has(r.agentId)) agents.set(r.agentId, await ctx.db.get(r.agentId));
      const agent = agents.get(r.agentId);
      page.push({
        id: r._id as string,
        status: r.status,
        agentName: agent?.name ?? "Deleted agent",
        agentSlug: agent?.slug ?? null,
        logoUrl: agent?.logoUrl ?? null,
        createdAt: r.createdAt,
        durationMs: r.durationMs ?? (r.finishedAt ? r.finishedAt - (r.startedAt ?? r.createdAt) : null),
        progressPct: r.progressPct ?? null,
        chargedCredits: r.chargedCredits ?? null,
        holdCredits: r.holdCredits ?? null,
        holdStatus: r.holdStatus ?? null,
        errorMessage: r.error?.message ?? null,
      });
    }
    return { ...res, page };
  },
});
