import type { MutationCtx, QueryCtx } from "./_generated/server";
import { components } from "./_generated/api";

/** Credits a buyer has tied up in runs that are still holding (not yet settled or released). */
export async function escrowCredits(ctx: QueryCtx | MutationCtx, userId: string): Promise<number> {
  const held = await ctx.db
    .query("runs")
    .withIndex("by_user_hold", (q) => q.eq("userId", userId).eq("holdStatus", "held"))
    .collect();
  return Math.round(held.reduce((sum, r) => sum + (r.holdCredits ?? 0), 0) * 100) / 100;
}

export async function getCredits(ctx: QueryCtx | MutationCtx, userId: string): Promise<number> {
  const user = await (ctx as any).runQuery(components.betterAuth.adapter.findOne, {
    model: "user",
    where: [{ field: "_id", value: userId }],
  });
  return Number(user?.credits ?? 0);
}

export async function setCredits(ctx: MutationCtx, userId: string, credits: number): Promise<void> {
  await (ctx as any).runMutation(components.betterAuth.adapter.updateOne, {
    input: {
      model: "user",
      where: [{ field: "_id", value: userId }],
      update: { credits: Math.round(credits * 100) / 100, updatedAt: Date.now() },
    },
  });
}
