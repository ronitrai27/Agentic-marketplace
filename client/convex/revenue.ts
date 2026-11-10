import { internalMutation, type MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { getCredits, setCredits } from "./escrow";
import { MICROS_PER_CREDIT, microsToCredits } from "../src/lib/agent-display";

/** Creator revenue rules. Fee rates are copied onto every ledger row, so changing them never rewrites history. */
export const COMMISSION_BPS = 1200; // 12% marketplace commission
export const PLATFORM_FEE_BPS = 100; // 1% platform fee
export const HOLD_MS = 48 * 3_600_000; // earnings clear after 48 hours
const RELEASE_BATCH = 100;

const bpsOf = (micros: number, bps: number) => Math.floor((micros * bps) / 10_000);

/** Splits a charge into commission, platform fee and creator net. The three parts always add up to the charge. */
export function splitCharge(grossMicros: number) {
  const commissionMicros = bpsOf(grossMicros, COMMISSION_BPS);
  const platformFeeMicros = bpsOf(grossMicros, PLATFORM_FEE_BPS);
  return { commissionMicros, platformFeeMicros, creatorNetMicros: grossMicros - commissionMicros - platformFeeMicros };
}

async function bumpDaily(
  ctx: MutationCtx,
  row: { creatorId: string; agentId: Id<"agents">; day: string },
  delta: Partial<Record<"settledRuns" | "grossMicros" | "commissionMicros" | "platformFeeMicros" | "creatorNetMicros" | "reversedMicros", number>>,
) {
  const existing = await ctx.db
    .query("creator_revenue_daily")
    .withIndex("by_creator_day", (q) => q.eq("creatorId", row.creatorId).eq("day", row.day))
    .collect()
    .then((rows) => rows.find((r) => r.agentId === row.agentId));
  const d = (k: keyof typeof delta) => delta[k] ?? 0;
  if (existing) {
    await ctx.db.patch(existing._id, {
      settledRuns: existing.settledRuns + d("settledRuns"),
      grossMicros: existing.grossMicros + d("grossMicros"),
      commissionMicros: existing.commissionMicros + d("commissionMicros"),
      platformFeeMicros: existing.platformFeeMicros + d("platformFeeMicros"),
      creatorNetMicros: existing.creatorNetMicros + d("creatorNetMicros"),
      reversedMicros: existing.reversedMicros + d("reversedMicros"),
    });
  } else {
    await ctx.db.insert("creator_revenue_daily", {
      creatorId: row.creatorId,
      agentId: row.agentId,
      day: row.day,
      settledRuns: d("settledRuns"),
      grossMicros: d("grossMicros"),
      commissionMicros: d("commissionMicros"),
      platformFeeMicros: d("platformFeeMicros"),
      creatorNetMicros: d("creatorNetMicros"),
      reversedMicros: d("reversedMicros"),
    });
  }
}

/**
 * Called from runs.complete in the same transaction that charges the buyer, so a charge and its earning
 * can never get out of step. One row per run (a retry finds the existing row). The money stays `pending` for 48 hours.
 */
export async function recordEarning(ctx: MutationCtx, run: Doc<"runs">, chargedCredits: number, now: number) {
  if (chargedCredits <= 0) return;
  const existing = await ctx.db.query("revenue_ledger").withIndex("by_run", (q) => q.eq("runId", run._id)).first();
  if (existing) return;
  const agent = await ctx.db.get(run.agentId);
  if (!agent) return;

  const grossMicros = Math.round(chargedCredits * MICROS_PER_CREDIT);
  const split = splitCharge(grossMicros);
  await ctx.db.insert("revenue_ledger", {
    runId: run._id,
    agentId: run.agentId,
    creatorId: agent.ownerId,
    buyerId: run.userId,
    grossMicros,
    commissionBps: COMMISSION_BPS,
    commissionMicros: split.commissionMicros,
    platformFeeBps: PLATFORM_FEE_BPS,
    platformFeeMicros: split.platformFeeMicros,
    creatorNetMicros: split.creatorNetMicros,
    status: "pending",
    availableAt: now + HOLD_MS,
    createdAt: now,
  });
  await bumpDaily(ctx, { creatorId: agent.ownerId, agentId: run.agentId, day: new Date(now).toISOString().slice(0, 10) }, {
    settledRuns: 1,
    grossMicros,
    ...split,
  });
}

/**
 * Hourly: pending earnings whose 48 hours are over become available and are added to the creator's wallet.
 * The status flip and the credit happen in one transaction, so a row is never credited twice.
 */
export const releaseDue = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const due = await ctx.db
      .query("revenue_ledger")
      .withIndex("by_status_available", (q) => q.eq("status", "pending").lte("availableAt", now))
      .take(RELEASE_BATCH);

    const perCreator = new Map<string, number>();
    for (const row of due) {
      await ctx.db.patch(row._id, { status: "available" });
      perCreator.set(row.creatorId, (perCreator.get(row.creatorId) ?? 0) + row.creatorNetMicros);
    }
    for (const [creatorId, micros] of perCreator) {
      await setCredits(ctx, creatorId, (await getCredits(ctx, creatorId)) + microsToCredits(micros));
    }
    // More left than one batch: keep going right away instead of waiting for the next hour
    if (due.length === RELEASE_BATCH) await ctx.scheduler.runAfter(0, internal.revenue.releaseDue, {});
    return { released: due.length };
  },
});

/**
 * A refund or dispute. Inside the 48 hours the creator was never credited, so the row is simply voided.
 * After release the credited amount is taken back from the wallet (never below zero).
 */
export const reverse = internalMutation({
  args: { runId: v.id("runs"), reason: v.string() },
  handler: async (ctx, { runId, reason }) => {
    const row = await ctx.db.query("revenue_ledger").withIndex("by_run", (q) => q.eq("runId", runId)).first();
    if (!row || row.status === "reversed") return { ok: false as const };
    if (row.status === "paid") return { ok: false as const, reason: "already_paid_out" };
    if (row.status === "available") {
      const balance = await getCredits(ctx, row.creatorId);
      await setCredits(ctx, row.creatorId, Math.max(0, balance - microsToCredits(row.creatorNetMicros)));
    }
    const now = Date.now();
    await ctx.db.patch(row._id, { status: "reversed", reversedAt: now, reversalReason: reason });
    await bumpDaily(ctx, { creatorId: row.creatorId, agentId: row.agentId, day: new Date(row.createdAt).toISOString().slice(0, 10) }, {
      reversedMicros: row.creatorNetMicros,
    });
    return { ok: true as const };
  },
});
