import { query } from "./_generated/server";
import { v } from "convex/values";

const DAY = 86_400_000;
const RANGE_MS = { "1d": DAY, "7d": 7 * DAY, "1m": 30 * DAY, "1y": 365 * DAY } as const;
/** Most rows one request returns. The page filters and pages these in the browser. */
const MAX_ROWS = 500;

/** The signed-in user's wallet statement: top-ups, withdrawals, run charges and earnings, newest first. */
export const myList = query({
  args: {
    range: v.union(v.literal("1d"), v.literal("7d"), v.literal("1m"), v.literal("1y"), v.literal("all")),
  },
  handler: async (ctx, { range }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return { rows: [], creditedCredits: 0, debitedCredits: 0, truncated: false };
    const since = range === "all" ? 0 : Date.now() - RANGE_MS[range];

    const found = await ctx.db
      .query("wallet_transactions")
      .withIndex("by_user_created", (q) => q.eq("userId", identity.subject).gte("createdAt", since))
      .order("desc")
      .take(MAX_ROWS + 1);
    const truncated = found.length > MAX_ROWS;
    const page = truncated ? found.slice(0, MAX_ROWS) : found;

    let creditedCredits = 0;
    let debitedCredits = 0;
    for (const t of page) {
      if (t.status !== "success") continue;
      if (t.direction === "credit") creditedCredits += t.credits;
      else debitedCredits += t.credits;
    }

    return {
      truncated,
      creditedCredits: Math.round(creditedCredits * 100) / 100,
      debitedCredits: Math.round(debitedCredits * 100) / 100,
      rows: page.map((t) => ({
        id: t._id,
        type: t.type,
        direction: t.direction,
        credits: t.credits,
        balanceAfter: t.balanceAfter ?? null,
        status: t.status,
        runId: t.runId ?? null,
        agentName: t.agentName ?? null,
        agentLogoUrl: t.agentLogoUrl ?? null,
        via: t.via ?? null,
        ref: t.ref ?? null,
        note: t.note ?? null,
        createdAt: t.createdAt,
      })),
    };
  },
});
