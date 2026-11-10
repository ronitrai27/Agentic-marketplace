import { query, mutation, internalQuery } from "./_generated/server";
import { components } from "./_generated/api";
import { escrowCredits } from "./escrow";
import { v } from "convex/values";
import { MICROS_PER_CREDIT } from "../src/lib/agent-display";

/** Smallest cash-out: $10. */
const MIN_WITHDRAW_CREDITS = 1000;

export const getWallet = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return {
        credits: 0,
        escrow: 0,
        withdrawableCredits: 0,
        withdrawableUsd: "0.00",
        totalUsd: "0.00",
        escrowUsd: "0.00",
      };
    }

    try {
      const user = await (ctx as any).runQuery(
        components.betterAuth.adapter.findOne,
        {
          model: "user",
          where: [{ field: "_id", value: identity.subject }],
        },
      );

      const credits = Number(user?.credits ?? 0);
      const escrow = await escrowCredits(ctx, identity.subject); // credits held for runs in progress
      // Creator earnings still inside their 48 hour hold: not in the balance yet
      const pendingRows = await ctx.db
        .query("revenue_ledger")
        .withIndex("by_creator_status", (q) => q.eq("creatorId", identity.subject).eq("status", "pending"))
        .collect();
      const pendingCredits =
        Math.round((pendingRows.reduce((s, r) => s + r.creatorNetMicros, 0) / MICROS_PER_CREDIT) * 100) / 100;
      const nextReleaseAt = pendingRows.length ? Math.min(...pendingRows.map((r) => r.availableAt)) : null;

      // Platform rule: User must maintain at least 500 credits ($5.00) reserve.
      // Funds in escrow cannot be withdrawn.
      const withdrawableCredits = Math.max(0, credits - 500 - escrow);

      return {
        credits,
        escrow,
        withdrawableCredits,
        pendingCredits,
        nextReleaseAt,
        minWithdrawCredits: MIN_WITHDRAW_CREDITS,
        withdrawableUsd: (withdrawableCredits / 100).toFixed(2),
        totalUsd: (credits / 100).toFixed(2),
        escrowUsd: (escrow / 100).toFixed(2),
        email: user?.email || identity.email,
      };
    } catch (e) {
      console.error("Error fetching wallet balance:", e);
      return {
        credits: 0,
        escrow: 0,
        withdrawableCredits: 0,
        withdrawableUsd: "0.00",
        totalUsd: "0.00",
        escrowUsd: "0.00",
      };
    }
  },
});

export const addCredits = mutation({
  args: {
    amountCredits: v.number(),
    orderId: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Unauthorized");
    }

    const user = await (ctx as any).runQuery(
      components.betterAuth.adapter.findOne,
      {
        model: "user",
        where: [{ field: "_id", value: identity.subject }],
      },
    );

    if (!user) {
      throw new Error("User not found");
    }

    const currentCredits = Number(user.credits ?? 0);
    const newCredits = currentCredits + args.amountCredits;

    await (ctx as any).runMutation(components.betterAuth.adapter.updateOne, {
      input: {
        model: "user",
        where: [{ field: "_id", value: identity.subject }],
        update: {
          credits: newCredits,
          updatedAt: Date.now(),
        },
      },
    });

    return { success: true, newCredits };
  },
});

export const deductCreditsForWithdrawal = mutation({
  args: {
    amountCredits: v.number(),
    payoutId: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Unauthorized");
    }

    const user = await (ctx as any).runQuery(
      components.betterAuth.adapter.findOne,
      {
        model: "user",
        where: [{ field: "_id", value: identity.subject }],
      },
    );

    if (!user) {
      throw new Error("User not found");
    }

    const currentCredits = Number(user.credits ?? 0);
    const escrow = await escrowCredits(ctx, identity.subject);
    const maxWithdrawable = Math.max(0, currentCredits - 500 - escrow);

    if (args.amountCredits < MIN_WITHDRAW_CREDITS) {
      throw new Error(
        `The minimum withdrawal is ${MIN_WITHDRAW_CREDITS} credits ($${(MIN_WITHDRAW_CREDITS / 100).toFixed(2)}).`,
      );
    }
    if (args.amountCredits > maxWithdrawable) {
      throw new Error(
        `Cannot withdraw ${args.amountCredits} credits. Maximum withdrawable is ${maxWithdrawable} credits ($${(maxWithdrawable / 100).toFixed(2)}) due to the $5 platform reserve floor.`,
      );
    }

    const newCredits = currentCredits - args.amountCredits;

    await (ctx as any).runMutation(components.betterAuth.adapter.updateOne, {
      input: {
        model: "user",
        where: [{ field: "_id", value: identity.subject }],
        update: {
          credits: newCredits,
          updatedAt: Date.now(),
        },
      },
    });

    return { success: true, newCredits };
  },
});

/** Wallet by explicit user id, for server-to-server callers (the MCP server). Not client-callable. */
export const getWalletByUserId = internalQuery({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    const user = await (ctx as any).runQuery(
      components.betterAuth.adapter.findOne,
      { model: "user", where: [{ field: "_id", value: args.userId }] },
    );
    if (!user) return null;

    const credits = Number(user.credits ?? 0);
    const escrow = await escrowCredits(ctx, args.userId);
    const withdrawableCredits = Math.max(0, credits - 500 - escrow);
    return {
      credits,
      escrow,
      withdrawableCredits,
      totalUsd: (credits / 100).toFixed(2),
      escrowUsd: (escrow / 100).toFixed(2),
      withdrawableUsd: (withdrawableCredits / 100).toFixed(2),
    };
  },
});
