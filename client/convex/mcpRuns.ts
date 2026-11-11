import { internalAction, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { ConvexError, v } from "convex/values";
import { admitHeldRun } from "./runs";
import { runQuote, microsToCredits, type PlanMicros } from "../src/lib/agent-display";

/** How long a human has to approve an MCP run request. */
const REQUEST_TTL_MS = 10 * 60_000;
const MAX_PENDING = 10;
const MAX_INPUT_CHARS = 256_000;
const MAX_OUTPUT_SHOWN = 20_000;
const MAX_AUTO_APPROVE = 10_000;

const TERMINAL = new Set(["succeeded", "failed", "cancelled"]);

/** Holds the money, queues the run and schedules the Temporal start. */
async function startNow(
  ctx: MutationCtx,
  args: { userId: string; slug: string; inputJson: string; clientName?: string },
) {
  const res = await admitHeldRun(ctx, {
    userId: args.userId,
    slug: args.slug,
    inputJson: args.inputJson,
    callerName: args.clientName ? `MCP: ${args.clientName}` : "MCP",
  });
  if (res.ok) {
    await ctx.scheduler.runAfter(0, internal.mcpRuns.launch, { runId: res.runId, timeoutSeconds: res.timeoutSeconds });
  }
  return res;
}

/** Starts the workflow. If Temporal can't be reached the run is closed and the hold is released. */
export const launch = internalAction({
  args: { runId: v.id("runs"), timeoutSeconds: v.number() },
  handler: async (ctx, { runId, timeoutSeconds }) => {
    try {
      await ctx.runAction(internal.temporal.startRunWorkflow, { runId, timeoutSeconds });
    } catch (err) {
      console.error("mcpRuns.launch failed", err);
      await ctx.runMutation(internal.runs.setStatus, {
        runId,
        status: "failed",
        error: { code: "WORKFLOW_START_FAILED", message: "Could not start the run. Nothing was charged." },
      });
    }
  },
});

// ─── MCP server side (guarded by MCP_BACKEND_SECRET in http.ts) ─────────────

/**
 * An MCP client wants to run an agent. Under the user's auto-approve limit it starts at once; otherwise a pending
 * request is stored and the human approves it in the web app. Nothing is held until then.
 */
export const requestRun = internalMutation({
  args: { userId: v.string(), slug: v.string(), inputJson: v.string(), clientName: v.optional(v.string()) },
  handler: async (ctx, args) => {
    if (args.inputJson.length > MAX_INPUT_CHARS) {
      return { ok: false as const, code: "PAYLOAD_TOO_LARGE", message: "Input is too large" };
    }
    try {
      const parsed = JSON.parse(args.inputJson);
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    } catch {
      return { ok: false as const, code: "INVALID_INPUT", message: "Input must be a JSON object" };
    }
    const agent = await ctx.db
      .query("agents")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .first();
    if (!agent || agent.status !== "active") {
      return { ok: false as const, code: "AGENT_NOT_FOUND", message: "No active agent with that slug" };
    }
    const price = await ctx.db
      .query("agent_pricing")
      .withIndex("by_agent_created", (q) => q.eq("agentId", agent._id))
      .order("desc")
      .first();
    const holdMicros = runQuote((price?.plan as PlanMicros | undefined) ?? null).holdMicros;
    if (!holdMicros) return { ok: false as const, code: "NO_PRICE", message: "This agent has no price set" };
    const holdCredits = microsToCredits(holdMicros);

    const settings = await ctx.db
      .query("mcp_settings")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .first();
    if (settings && settings.autoApproveCredits > 0 && holdCredits <= settings.autoApproveCredits) {
      const res = await startNow(ctx, args);
      if (!res.ok) return { ok: false as const, code: res.code, message: res.message };
      return {
        ok: true as const,
        state: "started" as const,
        runId: res.runId as string,
        agentName: agent.name,
        holdCredits,
      };
    }

    const now = Date.now();
    const pending = await ctx.db
      .query("mcp_run_requests")
      .withIndex("by_user_status", (q) => q.eq("userId", args.userId).eq("status", "pending"))
      .take(MAX_PENDING + 1);
    if (pending.filter((p) => p.expiresAt > now).length >= MAX_PENDING) {
      return {
        ok: false as const,
        code: "TOO_MANY_PENDING",
        message: "There are already many runs waiting for the user's approval. Ask them to approve or deny those first.",
      };
    }
    const requestId = await ctx.db.insert("mcp_run_requests", {
      userId: args.userId,
      agentId: agent._id,
      slug: agent.slug,
      agentName: agent.name,
      inputJson: args.inputJson,
      holdCredits,
      clientName: args.clientName?.slice(0, 80),
      status: "pending",
      createdAt: now,
      expiresAt: now + REQUEST_TTL_MS,
    });
    await ctx.scheduler.runAfter(REQUEST_TTL_MS, internal.mcpRuns.expire, { requestId });
    return {
      ok: true as const,
      state: "pending_approval" as const,
      requestId: requestId as string,
      agentName: agent.name,
      holdCredits,
      expiresAt: now + REQUEST_TTL_MS,
    };
  },
});

/** Status of a request or a run (either id works). Owner only. Includes the output once the run succeeded. */
export const status = internalQuery({
  args: { userId: v.string(), id: v.string() },
  handler: async (ctx, { userId, id }) => {
    let runId: Id<"runs"> | null = null;
    const reqId = ctx.db.normalizeId("mcp_run_requests", id);
    let request = reqId ? await ctx.db.get(reqId) : null;
    if (request && request.userId !== userId) request = null;
    if (request) {
      if (request.status === "pending") {
        const expired = Date.now() > request.expiresAt;
        return {
          found: true as const,
          state: expired ? ("expired" as const) : ("pending_approval" as const),
          requestId: request._id as string,
          agentName: request.agentName,
          holdCredits: request.holdCredits,
          expiresAt: request.expiresAt,
        };
      }
      if (!request.runId) {
        return {
          found: true as const,
          state: request.status as "denied" | "expired" | "failed",
          requestId: request._id as string,
          agentName: request.agentName,
          holdCredits: request.holdCredits,
          message: request.reason ?? null,
        };
      }
      runId = request.runId;
    } else {
      runId = ctx.db.normalizeId("runs", id);
    }
    const run = runId ? await ctx.db.get(runId) : null;
    if (!run || run.userId !== userId) return { found: false as const };
    const agent = await ctx.db.get(run.agentId);
    let outputJson: string | null = null;
    let outputTruncated = false;
    if (run.status === "succeeded") {
      const out = await ctx.db.query("run_outputs").withIndex("by_run", (q) => q.eq("runId", run._id)).first();
      if (out) {
        outputTruncated = out.outputJson.length > MAX_OUTPUT_SHOWN;
        outputJson = out.outputJson.slice(0, MAX_OUTPUT_SHOWN);
      }
    }
    const last = await ctx.db
      .query("run_events")
      .withIndex("by_run_seq", (q) => q.eq("runId", run._id))
      .order("desc")
      .first();
    return {
      found: true as const,
      state: run.status as "queued" | "running" | "succeeded" | "failed" | "cancelled",
      runId: run._id as string,
      requestId: request ? (request._id as string) : null,
      agentName: agent?.name ?? "Agent",
      holdCredits: run.holdCredits ?? null,
      chargedCredits: run.chargedCredits ?? null,
      progressPct: run.progressPct ?? null,
      lastEvent: last ? { type: last.type, data: last.dataJson.slice(0, 400) } : null,
      error: run.error ?? null,
      done: TERMINAL.has(run.status),
      outputJson,
      outputTruncated,
    };
  },
});

export const expire = internalMutation({
  args: { requestId: v.id("mcp_run_requests") },
  handler: async (ctx, { requestId }) => {
    const row = await ctx.db.get(requestId);
    if (row?.status === "pending") await ctx.db.patch(requestId, { status: "expired", decidedAt: Date.now() });
  },
});

// ─── Web app side (signed-in user) ──────────────────────────────────────────

/** The user's requests still waiting for an answer, newest first. Drives the approvals page. */
export const myPending = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const rows = await ctx.db
      .query("mcp_run_requests")
      .withIndex("by_user_status", (q) => q.eq("userId", identity.subject).eq("status", "pending"))
      .order("desc")
      .take(20);
    const now = Date.now();
    return rows
      .filter((r) => r.expiresAt > now)
      .map((r) => ({
        id: r._id as string,
        agentName: r.agentName,
        slug: r.slug,
        holdCredits: r.holdCredits,
        clientName: r.clientName ?? null,
        inputPreview: r.inputJson.length > 4000 ? `${r.inputJson.slice(0, 4000)}…` : r.inputJson,
        createdAt: r.createdAt,
        expiresAt: r.expiresAt,
      }));
  },
});

/** Approve (hold the money and start the run) or deny. Failures are recorded on the request and returned, not thrown. */
export const decide = mutation({
  args: { requestId: v.id("mcp_run_requests"), approve: v.boolean() },
  handler: async (ctx, { requestId, approve }): Promise<{ ok: boolean; message?: string }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Sign in first." });
    const row = await ctx.db.get(requestId);
    if (!row || row.userId !== identity.subject) throw new ConvexError({ code: "NOT_FOUND", message: "Request not found." });
    if (row.status !== "pending") return { ok: false, message: `This request was already ${row.status}.` };

    const now = Date.now();
    if (!approve) {
      await ctx.db.patch(requestId, { status: "denied", decidedAt: now, reason: "The user denied this run." });
      return { ok: true };
    }
    if (now > row.expiresAt) {
      await ctx.db.patch(requestId, { status: "expired", decidedAt: now });
      return { ok: false, message: "This request expired. Ask the assistant to send it again." };
    }
    const res = await startNow(ctx, {
      userId: row.userId,
      slug: row.slug,
      inputJson: row.inputJson,
      clientName: row.clientName,
    });
    if (!res.ok) {
      await ctx.db.patch(requestId, { status: "failed", decidedAt: now, reason: res.message });
      return { ok: false, message: res.message };
    }
    await ctx.db.patch(requestId, { status: "approved", decidedAt: now, runId: res.runId });
    return { ok: true };
  },
});

export const getSettings = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const row = await ctx.db
      .query("mcp_settings")
      .withIndex("by_user", (q) => q.eq("userId", identity.subject))
      .first();
    return { autoApproveCredits: row?.autoApproveCredits ?? 0 };
  },
});

export const setAutoApprove = mutation({
  args: { credits: v.number() },
  handler: async (ctx, { credits }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Sign in first." });
    if (!Number.isFinite(credits) || credits < 0 || credits > MAX_AUTO_APPROVE) {
      throw new ConvexError({ code: "INVALID", message: `Enter 0 to ${MAX_AUTO_APPROVE} credits.` });
    }
    const value = Math.round(credits * 100) / 100;
    const row = await ctx.db
      .query("mcp_settings")
      .withIndex("by_user", (q) => q.eq("userId", identity.subject))
      .first();
    if (row) await ctx.db.patch(row._id, { autoApproveCredits: value, updatedAt: Date.now() });
    else await ctx.db.insert("mcp_settings", { userId: identity.subject, autoApproveCredits: value, updatedAt: Date.now() });
    return { autoApproveCredits: value };
  },
});
