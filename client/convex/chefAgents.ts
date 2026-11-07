import { ConvexError, v } from "convex/values";
import { query } from "./_generated/server";

/**
 * Facts the chef ranks agents on, for the ids the search index returned. The index can lag behind Convex, so every
 * agent is re-checked here: archived and suspended agents are dropped before the model ever sees them
 * (active and paused ones are shown). The creator's private price floor is never read.
 */
export const enrich = query({
  args: { ids: v.array(v.string()) },
  handler: async (ctx, { ids }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Sign in first." });

    const out = [];
    for (const raw of ids.slice(0, 30)) {
      const id = ctx.db.normalizeId("agents", raw);
      if (!id) continue;
      const a = await ctx.db.get(id);
      if (!a || a.status === "archived" || a.status === "suspended") continue;

      const stats = await ctx.db
        .query("agent_stats")
        .withIndex("by_agent", (q) => q.eq("agentId", id))
        .first();
      const price = await ctx.db
        .query("agent_pricing")
        .withIndex("by_agent_created", (q) => q.eq("agentId", id))
        .order("desc")
        .first();

      let priceFromMicros: number | null = null;
      let pricingShape: "per_run" | "per_unit" | "tiered" | null = null;
      if (price) {
        pricingShape = price.plan.shape;
        if (price.plan.shape === "per_run") priceFromMicros = price.plan.priceMicros;
        else if (price.plan.shape === "per_unit") priceFromMicros = price.plan.minChargeMicros;
        else priceFromMicros = Math.min(...price.plan.tiers.map((t) => t.priceMicros));
      }

      out.push({
        id: a._id as string,
        slug: a.slug,
        name: a.name,
        description: a.description,
        capabilities: a.keyCapabilities ?? [],
        logoUrl: a.logoUrl,
        tags: a.tags,
        models: a.models,
        ratingAvg: a.ratingAvg ?? 0,
        ratingCount: a.ratingCount ?? 0,
        totalRuns: stats?.totalRuns ?? 0,
        successRate: stats && stats.totalRuns > 0 ? stats.successRuns / stats.totalRuns : null,
        avgLatencyMs: stats && stats.totalRuns > 0 ? Math.round(stats.totalLatencyMs / stats.totalRuns) : null,
        pricingShape,
        priceFromMicros,
      });
    }
    return out;
  },
});

/**
 * What the search index is built from: the searchable text of every agent that can appear in search (archived and
 * suspended ones are left out, which is how they leave the index). Public marketplace fields only, like listFeatured.
 */
export const listForIndex = query({
  args: {},
  handler: async (ctx) => {
    const agents = await ctx.db.query("agents").collect();
    return agents
      .filter((a) => a.status !== "archived" && a.status !== "suspended")
      .map((a) => ({
        id: a._id as string,
        slug: a.slug,
        name: a.name,
        description: a.description,
        tags: a.tags,
        capabilities: a.keyCapabilities ?? [],
      }));
  },
});

/**
 * The whole catalog in slim form, for the search bar to search in the browser. Live (the bar updates when an agent
 * is added, edited or archived) and public marketplace fields only; archived and suspended agents are left out.
 */
export const listForSearch = query({
  args: {},
  handler: async (ctx) => {
    const agents = await ctx.db.query("agents").collect();
    return agents
      .filter((a) => a.status !== "archived" && a.status !== "suspended")
      .map((a) => ({
        id: a._id as string,
        slug: a.slug,
        name: a.name,
        logoUrl: a.logoUrl,
        tags: a.tags,
        models: a.models.map((m) => m.id),
        ratingAvg: a.ratingAvg ?? 0,
        ratingCount: a.ratingCount ?? 0,
        blurb: `${a.description} ${(a.keyCapabilities ?? []).join(" ")}`.slice(0, 320),
      }));
  },
});
