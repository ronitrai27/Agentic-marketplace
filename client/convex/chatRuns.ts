import { internalMutation, mutation, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { ConvexError, v } from "convex/values";
import { escrowCredits, getCredits } from "./escrow";
import { microsToCredits, runQuote, type PlanMicros } from "../src/lib/agent-display";

/** A run proposal can be approved for this long; after that nothing can be held from it. */
export const PROPOSAL_TTL_MS = 10 * 60_000;
const MAX_AGENTS = 2;

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * The chef's propose_run tool calls this (as the signed-in user). It reads prices and the wallet, stores the
 * proposal and drops a "proposal" message into the chat, so the approval card is there even after a refresh.
 * Nothing is held here: holds happen only after the human approves.
 */
export const propose = mutation({
  args: { chatId: v.string(), proposalId: v.string(), agentIds: v.array(v.string()) },
  handler: async (ctx, { chatId, proposalId, agentIds }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Sign in first." });
    const userId = identity.subject;

    const chat = await ctx.db
      .query("chats")
      .withIndex("by_chatId", (q) => q.eq("chatId", chatId))
      .first();
    if (chat && chat.userId !== userId) throw new ConvexError({ code: "NOT_FOUND", message: "Chat not found." });

    const ids = [...new Set(agentIds)].slice(0, MAX_AGENTS);
    const agents: Doc<"chat_runs">["agents"] = [];
    const problems: string[] = [];
    for (const raw of ids) {
      const id = ctx.db.normalizeId("agents", raw);
      const agent = id ? await ctx.db.get(id) : null;
      if (!agent || agent.status === "archived" || agent.status === "suspended") {
        problems.push("One of those agents is no longer available.");
        continue;
      }
      if (agent.status === "paused") {
        problems.push(`${agent.name} is paused and cannot run right now.`);
        continue;
      }
      const price = await ctx.db
        .query("agent_pricing")
        .withIndex("by_agent_created", (q) => q.eq("agentId", agent._id))
        .order("desc")
        .first();
      const plan = (price?.plan as PlanMicros | undefined) ?? null;
      // runQuote holds the highest tier for tiered plans and the max units for per-unit plans
      const holdMicros = runQuote(plan).holdMicros;
      if (!holdMicros) {
        problems.push(`${agent.name} has no price set, so it cannot run yet.`);
        continue;
      }
      agents.push({
        agentId: agent._id,
        slug: agent.slug,
        name: agent.name,
        logoUrl: agent.logoUrl ?? undefined,
        holdCredits: microsToCredits(holdMicros),
        tiered: plan?.shape === "tiered",
      });
    }
    if (agents.length === 0) return { ok: false as const, problems };

    const existing = await ctx.db
      .query("chat_runs")
      .withIndex("by_proposal", (q) => q.eq("proposalId", proposalId))
      .first();
    if (existing) throw new ConvexError({ code: "DUPLICATE", message: "Proposal already exists." });

    const now = Date.now();
    const totalCredits = round2(agents.reduce((s, a) => s + a.holdCredits, 0));
    const available = round2((await getCredits(ctx, userId)) - (await escrowCredits(ctx, userId)));
    await ctx.db.insert("chat_runs", {
      chatId,
      userId,
      proposalId,
      agents,
      totalCredits,
      status: "pending",
      runIds: [],
      createdAt: now,
      expiresAt: now + PROPOSAL_TTL_MS,
    });
    await ctx.db.insert("chat_messages", {
      chatId,
      userId,
      messageId: `proposal-${proposalId}`,
      role: "assistant",
      kind: "proposal",
      text: "",
      proposalId,
      createdAt: now,
      ord: 0,
    });
    await ctx.scheduler.runAfter(PROPOSAL_TTL_MS, internal.chatRuns.expire, { proposalId });
    return {
      ok: true as const,
      problems,
      agents: agents.map((a) => ({ name: a.name, holdCredits: a.holdCredits, tiered: a.tiered })),
      totalCredits,
      available: Math.max(0, available),
      enough: available >= totalCredits,
      expiresAt: now + PROPOSAL_TTL_MS,
    };
  },
});

/**
 * The human's answer, recorded by the chef route before it resumes the graph. Approved runs were already held by
 * the browser (runs.hold with this chat id); they are checked to belong to this user and to the proposed agents.
 */
export const decide = mutation({
  args: {
    proposalId: v.string(),
    decision: v.union(v.literal("approved"), v.literal("denied"), v.literal("expired")),
    runIds: v.optional(v.array(v.id("runs"))),
  },
  handler: async (ctx, { proposalId, decision, runIds }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Sign in first." });
    const row = await ctx.db
      .query("chat_runs")
      .withIndex("by_proposal", (q) => q.eq("proposalId", proposalId))
      .first();
    if (!row || row.userId !== identity.subject) throw new ConvexError({ code: "NOT_FOUND", message: "Proposal not found." });
    if (row.status !== "pending") return { status: row.status };

    const now = Date.now();
    if (decision === "approved" && now > row.expiresAt) {
      await ctx.db.patch(row._id, { status: "expired", decidedAt: now });
      return { status: "expired" as const };
    }
    let kept: Id<"runs">[] = [];
    if (decision === "approved") {
      const allowed = new Set(row.agents.map((a) => a.agentId as string));
      for (const id of runIds ?? []) {
        const run = await ctx.db.get(id);
        if (run && run.userId === identity.subject && allowed.has(run.agentId as string) && !kept.includes(id)) kept.push(id);
      }
      if (kept.length === 0) throw new ConvexError({ code: "NO_RUNS", message: "No held runs for this proposal." });
    }
    await ctx.db.patch(row._id, { status: decision, runIds: kept, decidedAt: now });
    return { status: decision };
  },
});

export const expire = internalMutation({
  args: { proposalId: v.string() },
  handler: async (ctx, { proposalId }) => {
    const row = await ctx.db
      .query("chat_runs")
      .withIndex("by_proposal", (q) => q.eq("proposalId", proposalId))
      .first();
    if (row?.status === "pending") await ctx.db.patch(row._id, { status: "expired", decidedAt: Date.now() });
  },
});

/** One run as the chat shows it: status, progress, timer and only the newest event. Owner only. */
export const runCard = query({
  args: { runId: v.id("runs") },
  handler: async (ctx, { runId }) => {
    const identity = await ctx.auth.getUserIdentity();
    const run = await ctx.db.get(runId);
    if (!identity || !run || run.userId !== identity.subject) return null;
    const agent = await ctx.db.get(run.agentId);
    const last = await ctx.db
      .query("run_events")
      .withIndex("by_run_seq", (q) => q.eq("runId", runId))
      .order("desc")
      .first();
    return {
      id: run._id as string,
      status: run.status,
      progressPct: run.progressPct ?? null,
      createdAt: run.createdAt,
      startedAt: run.startedAt ?? null,
      finishedAt: run.finishedAt ?? null,
      holdCredits: run.holdCredits ?? null,
      chargedCredits: run.chargedCredits ?? null,
      error: run.error ?? null,
      agent: { name: agent?.name ?? "Agent", slug: agent?.slug ?? "", logoUrl: agent?.logoUrl ?? null },
      /** Only while the input is still to be given: the chat renders the input form from it. */
      inputSchemaJson: run.status === "awaiting_input" ? (agent?.inputSchemaJson ?? "{}") : null,
      last: last ? { type: last.type, dataJson: last.dataJson.slice(0, 600), at: last.at } : null,
    };
  },
});

/** The newest runs started from one chat, for the chef's per-turn awareness note. Owner only, small on purpose. */
export const chatRunsNote = query({
  args: { chatId: v.string() },
  handler: async (ctx, { chatId }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const rows = await ctx.db
      .query("runs")
      .withIndex("by_user_created", (q) => q.eq("userId", identity.subject))
      .order("desc")
      .take(40);
    const out = [];
    for (const r of rows) {
      if (r.chatId !== chatId) continue;
      const agent = await ctx.db.get(r.agentId);
      out.push({
        id: r._id as string,
        agentName: agent?.name ?? "Agent",
        status: r.status,
        finishedAt: r.finishedAt ?? null,
        chargedCredits: r.chargedCredits ?? null,
      });
      if (out.length === 5) break;
    }
    return out;
  },
});

/** One run in full for the chef's get_run_results tool: by id, or the newest finished run of this chat. Owner only. */
export const runResult = query({
  args: { chatId: v.string(), runId: v.optional(v.string()) },
  handler: async (ctx, { chatId, runId }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    let run: Doc<"runs"> | null = null;
    if (runId) {
      const id = ctx.db.normalizeId("runs", runId);
      run = id ? await ctx.db.get(id) : null;
    } else {
      const rows = await ctx.db
        .query("runs")
        .withIndex("by_user_created", (q) => q.eq("userId", identity.subject))
        .order("desc")
        .take(40);
      run = rows.find((r) => r.chatId === chatId && ["succeeded", "failed", "cancelled"].includes(r.status)) ?? null;
    }
    if (!run || run.userId !== identity.subject) return null;
    const agent = await ctx.db.get(run.agentId);
    const output = await ctx.db.query("run_outputs").withIndex("by_run", (q) => q.eq("runId", run!._id)).first();
    const events = await ctx.db
      .query("run_events")
      .withIndex("by_run_seq", (q) => q.eq("runId", run!._id))
      .order("desc")
      .take(60);
    const check = events.find((e) => e.type === "schema.check");
    return {
      id: run._id as string,
      agentName: agent?.name ?? "Agent",
      status: run.status,
      createdAt: run.createdAt,
      durationMs: run.durationMs ?? (run.finishedAt ? run.finishedAt - (run.startedAt ?? run.createdAt) : null),
      holdCredits: run.holdCredits ?? null,
      chargedCredits: run.chargedCredits ?? null,
      error: run.error ?? null,
      inputJson: run.inputLarge ? null : run.inputJson.slice(0, 800),
      outputJson: output?.outputJson?.slice(0, 6000) ?? null,
      outputChars: output?.outputJson?.length ?? 0,
      schemaCheckJson: check?.dataJson.slice(0, 300) ?? null,
    };
  },
});

/** The signed-in user's own runs for the chef's list_my_runs tool: newest first, input-pending holds left out. */
export const listMine = query({
  args: {
    status: v.optional(v.union(v.literal("succeeded"), v.literal("failed"), v.literal("active"), v.literal("cancelled"))),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { status, limit }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const n = Math.min(Math.max(Math.floor(limit ?? 5), 1), 10);
    const rows = await ctx.db
      .query("runs")
      .withIndex("by_user_created", (q) => q.eq("userId", identity.subject))
      .order("desc")
      .filter((q) =>
        !status
          ? q.neq(q.field("status"), "awaiting_input")
          : status === "active"
            ? q.or(q.eq(q.field("status"), "queued"), q.eq(q.field("status"), "running"))
            : q.eq(q.field("status"), status),
      )
      .take(n);
    const agents = new Map<string, Doc<"agents"> | null>();
    const out = [];
    for (const r of rows) {
      if (!agents.has(r.agentId)) agents.set(r.agentId, await ctx.db.get(r.agentId));
      const agent = agents.get(r.agentId);
      out.push({
        id: r._id as string,
        agentName: agent?.name ?? "Deleted agent",
        logoUrl: agent?.logoUrl ?? null,
        status: r.status,
        createdAt: r.createdAt,
        durationMs: r.durationMs ?? (r.finishedAt ? r.finishedAt - (r.startedAt ?? r.createdAt) : null),
        chargedCredits: r.chargedCredits ?? null,
      });
    }
    return out;
  },
});

/**
 * Posts the chef's "your run finished" message into the chat that started the run, the moment the run ends.
 * Called from every place a run reaches a final state. Written once per run (keyed by run id).
 */
export async function announceRunEnd(ctx: MutationCtx, run: Doc<"runs">, outcome: "succeeded" | "failed" | "cancelled", detail?: { charged?: number; error?: string }) {
  if (!run.chatId) return;
  const messageId = `run-end-${run._id}`;
  const dup = await ctx.db
    .query("chat_messages")
    .withIndex("by_chat_message", (q) => q.eq("chatId", run.chatId!).eq("messageId", messageId))
    .first();
  if (dup) return;
  const agent = await ctx.db.get(run.agentId);
  const name = agent?.name ?? "The agent";
  const text =
    outcome === "succeeded"
      ? `**${name}** is done. Its output passed the agent's output schema check` +
        (detail?.charged !== undefined ? ` and ${detail.charged} credits were charged (the rest of the hold is back in your wallet).` : ".") +
        " Open it below, or press Ctrl+Shift+B."
      : outcome === "failed"
        ? `**${name}** failed: ${detail?.error ?? "unknown error"}. The held credits were released, nothing was charged.`
        : `**${name}** was cancelled${detail?.error ? `: ${detail.error}` : ""}. The held credits were released.`;
  const now = Date.now();
  await ctx.db.insert("chat_messages", {
    chatId: run.chatId,
    userId: run.userId,
    messageId,
    role: "assistant",
    kind: "run_done",
    text,
    runId: run._id,
    createdAt: now,
    ord: 0,
  });
  const chat = await ctx.db
    .query("chats")
    .withIndex("by_chatId", (q) => q.eq("chatId", run.chatId!))
    .first();
  if (chat) await ctx.db.patch(chat._id, { lastMessageAt: Math.max(chat.lastMessageAt, now) });
}
