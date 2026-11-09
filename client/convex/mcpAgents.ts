import { internalQuery } from "./_generated/server";
import { v } from "convex/values";
import { priceSummary, type PlanMicros } from "../src/lib/agent-display";

const MAX_LIMIT = 25;
const MAX_SLUGS = 5;

/** Buyer-safe price. Never includes the creator's private negotiation floor. */
function publicPlan(plan: PlanMicros | null) {
  if (!plan) return null;
  const usd = (m: number) => m / 1_000_000;
  if (plan.shape === "per_run") return { shape: "per_run", priceUsd: usd(plan.priceMicros) };
  if (plan.shape === "per_unit") {
    return {
      shape: "per_unit",
      unitLabel: plan.unitLabel,
      pricePerUnitUsd: usd(plan.pricePerUnitMicros),
      minChargeUsd: usd(plan.minChargeMicros),
      maxUnitsPerRun: plan.maxUnitsPerRun ?? null,
      countKey: plan.countKey,
    };
  }
  return {
    shape: "tiered",
    fieldKey: plan.fieldKey,
    tiers: plan.tiers.map((t) => ({ value: t.value, priceUsd: usd(t.priceMicros) })),
  };
}

/** Active agents, filtered by free-text query and/or tag. Lean rows only: no schemas. */
export const discover = internalQuery({
  args: {
    query: v.optional(v.string()),
    tag: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = Math.min(Math.max(Math.floor(args.limit ?? 10), 1), MAX_LIMIT);
    const terms = (args.query ?? "").toLowerCase().split(/\s+/).filter(Boolean);
    const tag = args.tag?.trim().toLowerCase();

    const agents = await ctx.db
      .query("agents")
      .withIndex("by_status", (q) => q.eq("status", "active"))
      .take(1000);

    const scored = agents
      .filter((a) => !tag || a.tags.includes(tag))
      .map((a) => {
        const name = a.name.toLowerCase();
        const hay = `${name} ${a.slug} ${a.description.toLowerCase()} ${a.tags.join(" ")} ${(a.keyCapabilities ?? []).join(" ").toLowerCase()}`;
        let score = 0;
        for (const t of terms) {
          if (name.includes(t)) score += 3;
          else if (hay.includes(t)) score += 1;
        }
        return { a, score };
      })
      .filter((x) => terms.length === 0 || x.score > 0)
      .sort((x, y) => y.score - x.score || (y.a.ratingAvg ?? 0) - (x.a.ratingAvg ?? 0))
      .slice(0, limit);

    return await Promise.all(
      scored.map(async ({ a }) => {
        const price = await ctx.db
          .query("agent_pricing")
          .withIndex("by_agent_created", (q) => q.eq("agentId", a._id))
          .order("desc")
          .first();
        const stats = await ctx.db
          .query("agent_stats")
          .withIndex("by_agent", (q) => q.eq("agentId", a._id))
          .first();
        const plan = (price?.plan as PlanMicros | undefined) ?? null;
        return {
          slug: a.slug,
          name: a.name,
          description: a.description,
          tags: a.tags,
          keyCapabilities: a.keyCapabilities ?? [],
          price: priceSummary(plan),
          rating: a.ratingAvg ?? 0,
          ratingCount: a.ratingCount ?? 0,
          totalRuns: stats?.totalRuns ?? 0,
          successRate:
            stats && stats.totalRuns > 0 ? Math.round((stats.successRuns / stats.totalRuns) * 100) : null,
          avgLatencyMs:
            stats && stats.totalRuns > 0 ? Math.round(stats.totalLatencyMs / stats.totalRuns) : null,
        };
      }),
    );
  },
});

/** Full contract (input/output JSON Schema, pricing, limits) for up to 5 agents by slug. */
export const schemasBySlugs = internalQuery({
  args: { slugs: v.array(v.string()) },
  handler: async (ctx, args) => {
    const slugs = [...new Set(args.slugs.map((s) => s.trim().toLowerCase()).filter(Boolean))].slice(0, MAX_SLUGS);
    const found: unknown[] = [];
    const notFound: string[] = [];

    for (const slug of slugs) {
      const a = await ctx.db
        .query("agents")
        .withIndex("by_slug", (q) => q.eq("slug", slug))
        .first();
      if (!a || a.status !== "active") {
        notFound.push(slug);
        continue;
      }
      const price = await ctx.db
        .query("agent_pricing")
        .withIndex("by_agent_created", (q) => q.eq("agentId", a._id))
        .order("desc")
        .first();
      const plan = (price?.plan as PlanMicros | undefined) ?? null;
      let inputSchema: unknown = {};
      let outputSchema: unknown = {};
      try {
        inputSchema = JSON.parse(a.inputSchemaJson);
        outputSchema = JSON.parse(a.outputSchemaJson);
      } catch {
        /* keep empty schemas */
      }
      found.push({
        slug: a.slug,
        name: a.name,
        description: a.description,
        tags: a.tags,
        inputSchema,
        outputSchema,
        pricing: publicPlan(plan),
        priceSummary: priceSummary(plan),
        platformFeeRate: 0.12,
        limits: {
          maxTimeoutSeconds: a.capabilities?.max_timeout_seconds ?? null,
          maxConcurrent: a.capabilities?.max_concurrent ?? null,
          rateLimitPerMin: a.capabilities?.rate_limit_per_min ?? null,
        },
      });
    }
    return { agents: found, notFound };
  },
});
