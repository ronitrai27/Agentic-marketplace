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
      last: last ? { type: last.type, dataJson: last.dataJson.slice(0, 600), at: last.at } : null,
    };
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
