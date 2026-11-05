import { query } from "./_generated/server";
import { components } from "./_generated/api";
import { v } from "convex/values";

const CHART_DAYS = 90;
/** First page of reviews baked into the cached page; the rest load live. */
const REVIEW_LIMIT = 10;

/** Live stats and the daily series for the agent page (the page itself is cached, so it reads this separately). */
export const activity = query({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    const agent = await ctx.db
      .query("agents")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .first();
    if (!agent || agent.status === "archived" || agent.status === "suspended") return null;
    const stats = await ctx.db
      .query("agent_stats")
      .withIndex("by_agent", (q) => q.eq("agentId", agent._id))
      .first();
    const start = new Date(Date.now() - (CHART_DAYS - 1) * 86_400_000).toISOString().slice(0, 10);
    const daily = await ctx.db
      .query("agent_stats_daily")
      .withIndex("by_agent_day", (q) => q.eq("agentId", agent._id).gte("day", start))
      .collect();
    return {
      stats: {
        totalRuns: stats?.totalRuns ?? 0,
        successRuns: stats?.successRuns ?? 0,
        failedRuns: stats?.failedRuns ?? 0,
        totalLatencyMs: stats?.totalLatencyMs ?? 0,
      },
      daily: daily.map((d) => ({
        day: d.day,
        totalRuns: d.totalRuns,
        successRuns: d.successRuns,
        failedRuns: d.failedRuns,
        totalLatencyMs: d.totalLatencyMs,
      })),
    };
  },
});

/**
 * Everything the public agent page shows, in one query (the page caches it in Redis).
 * Deliberately leaves out the endpoint URL and the creator's private negotiation floor.
 */
export const getBySlug = query({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    const agent = await ctx.db
      .query("agents")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .first();
    if (!agent || agent.status === "archived" || agent.status === "suspended") return null;

    const owner = await (ctx as any)
      .runQuery(components.betterAuth.adapter.findOne, {
        model: "user",
        where: [{ field: "_id", value: agent.ownerId }],
      })
      .catch(() => null);

    const pricingRow = await ctx.db
      .query("agent_pricing")
      .withIndex("by_agent_created", (q) => q.eq("agentId", agent._id))
      .order("desc")
      .first();
    let pricing = null;
    if (pricingRow) {
      const plan = pricingRow.plan;
      pricing =
        plan.shape === "per_run"
          ? { shape: plan.shape, priceMicros: plan.priceMicros, negotiable: !!plan.negotiation }
          : plan;
    }

    const stats = await ctx.db
      .query("agent_stats")
      .withIndex("by_agent", (q) => q.eq("agentId", agent._id))
      .first();

    const start = new Date(Date.now() - (CHART_DAYS - 1) * 86_400_000).toISOString().slice(0, 10);
    const daily = await ctx.db
      .query("agent_stats_daily")
      .withIndex("by_agent_day", (q) => q.eq("agentId", agent._id).gte("day", start))
      .collect();

    const reviews = await ctx.db
      .query("agent_reviews")
      .withIndex("by_agent_created", (q) => q.eq("agentId", agent._id))
      .order("desc")
      .take(REVIEW_LIMIT);

    return {
      name: agent.name,
      slug: agent.slug,
      description: agent.description,
      logoUrl: agent.logoUrl,
      status: agent.status,
      version: agent.version,
      tags: agent.tags,
      keyCapabilities: agent.keyCapabilities ?? [],
      models: agent.models,
      inputSchemaJson: agent.inputSchemaJson,
      outputSchemaJson: agent.outputSchemaJson,
      ratingAvg: agent.ratingAvg ?? 0,
      ratingCount: agent.ratingCount ?? 0,
      createdAt: agent.createdAt,
      owner: { name: (owner?.name as string | undefined) ?? "Unknown creator", image: (owner?.image as string | null | undefined) ?? null },
      pricing,
      stats: {
        totalRuns: stats?.totalRuns ?? 0,
        successRuns: stats?.successRuns ?? 0,
        failedRuns: stats?.failedRuns ?? 0,
        totalLatencyMs: stats?.totalLatencyMs ?? 0,
      },
      daily: daily.map((d) => ({
        day: d.day,
        totalRuns: d.totalRuns,
        successRuns: d.successRuns,
        failedRuns: d.failedRuns,
        totalLatencyMs: d.totalLatencyMs,
      })),
      reviews: reviews.map((r) => ({
        id: r._id as string,
        userName: r.userName,
        userAvatar: r.userAvatar ?? null,
        rating: r.rating,
        comment: r.comment,
        likes: r.likes ?? 0,
        createdAt: r.createdAt,
        isOwner: r.userId === agent.ownerId,
      })),
    };
  },
});
