import { internalMutation, mutation, query, type MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { validateTags } from "../src/lib/agent-tags";
import { priceSummary, type PlanMicros } from "../src/lib/agent-display";
import { cleanCapabilities } from "../src/lib/agent-capabilities";
import { validateDescription } from "../src/lib/agent-description";
import {
  resolvePricing,
  validatePlan,
  type PricingPlan,
} from "../src/lib/pricing-plan";

const MAX_SCHEMA_CHARS = 200_000;
const MICROS = 1_000_000;
const toMicros = (usd: number) => Math.round(usd * MICROS);

// Prices arrive in USD from the form (the same shape the client validates) and are stored as micros.
const planArg = v.union(
  v.object({
    shape: v.literal("per_run"),
    priceUsd: v.number(),
    negotiation: v.optional(v.object({ minPriceUsd: v.number() })),
  }),
  v.object({
    shape: v.literal("per_unit"),
    unitLabel: v.string(),
    countKey: v.string(),
    outputKey: v.string(),
    pricePerUnitUsd: v.number(),
    minChargeUsd: v.number(),
    maxUnitsPerRun: v.optional(v.number()),
  }),
  v.object({
    shape: v.literal("tiered"),
    fieldKey: v.string(),
    tiers: v.array(v.object({ value: v.string(), priceUsd: v.number() })),
  }),
);

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40)
      .replace(/-+$/g, "") || "agent"
  );
}

/** A free slug for this name. `selfId` lets an agent keep a slug it already owns when it is renamed. */
async function uniqueSlug(ctx: MutationCtx, name: string, selfId?: Id<"agents">): Promise<string> {
  const base = slugify(name);
  for (let i = 1; i <= 50; i++) {
    const candidate = i === 1 ? base : `${base}-${i}`;
    const taken = await ctx.db
      .query("agents")
      .withIndex("by_slug", (q) => q.eq("slug", candidate))
      .first();
    if (!taken || taken._id === selfId) return candidate;
  }
  return `${base}-${Date.now().toString(36)}`;
}

/** Names are unique marketplace-wide, ignoring case and extra spaces. */
const nameKeyOf = (name: string) => name.trim().replace(/\s+/g, " ").toLowerCase();

/**
 * Throws when another agent already uses this name. Checks the stored key and the base slug, so agents saved
 * before `nameKey` existed are covered too. Archived agents keep their name until the daily cleanup removes them.
 */
async function assertNameFree(ctx: MutationCtx, name: string, selfId?: Id<"agents">) {
  const key = nameKeyOf(name);
  const byKey = await ctx.db.query("agents").withIndex("by_nameKey", (q) => q.eq("nameKey", key)).first();
  const bySlug = await ctx.db.query("agents").withIndex("by_slug", (q) => q.eq("slug", slugify(name))).first();
  const clash = [byKey, bySlug].find((a) => a && a._id !== selfId && nameKeyOf(a.name) === key);
  if (clash) throw new Error("This agent name is already taken. Choose another name.");
}

function normaliseUrl(raw: string): string {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    throw new Error("Agent URL is not valid.");
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") {
    throw new Error("Agent URL must start with http:// or https://.");
  }
  return `${u.origin}${u.pathname.replace(/\/+$/, "")}`;
}

function parseSchema(json: string, label: string): Record<string, unknown> {
  if (json.length > MAX_SCHEMA_CHARS) throw new Error(`${label} is too large.`);
  try {
    const parsed = JSON.parse(json);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    throw new Error(`${label} is not valid JSON.`);
  }
}

function planToMicros(plan: PricingPlan) {
  if (plan.shape === "per_run") {
    return {
      shape: "per_run" as const,
      priceMicros: toMicros(plan.priceUsd),
      ...(plan.negotiation && {
        negotiation: { minPriceMicros: toMicros(plan.negotiation.minPriceUsd) },
      }),
    };
  }
  if (plan.shape === "per_unit") {
    return {
      shape: "per_unit" as const,
      unitLabel: plan.unitLabel.trim(),
      countKey: plan.countKey,
      outputKey: plan.outputKey,
      pricePerUnitMicros: toMicros(plan.pricePerUnitUsd),
      minChargeMicros: toMicros(plan.minChargeUsd),
      ...(plan.maxUnitsPerRun !== undefined && { maxUnitsPerRun: plan.maxUnitsPerRun }),
    };
  }
  return {
    shape: "tiered" as const,
    fieldKey: plan.fieldKey,
    tiers: plan.tiers.map((t) => ({ value: t.value, priceMicros: toMicros(t.priceUsd) })),
  };
}

function cleanLogoUrl(url: string | undefined) {
  if (!url) return undefined;
  if (!/^https:\/\/[^\s]+\.png$/i.test(url) || url.length > 300) {
    throw new Error("Invalid logo URL.");
  }
  return url;
}

export const register = mutation({
  args: {
    name: v.string(),
    description: v.string(),
    logoUrl: v.optional(v.string()),
    baseUrl: v.string(),
    version: v.string(),
    manifestAgentId: v.optional(v.string()),
    platform: v.optional(v.literal("n8n")),
    capabilities: v.optional(
      v.object({
        streaming: v.optional(v.boolean()),
        delta_stream: v.optional(v.boolean()),
        max_timeout_seconds: v.optional(v.number()),
        execution_modes: v.optional(v.array(v.string())),
      }),
    ),
    inputSchemaJson: v.string(),
    outputSchemaJson: v.string(),
    tags: v.array(v.string()),
    plan: planArg,
    models: v.array(
      v.object({
        id: v.string(),
        provider: v.optional(v.string()),
      }),
    ),
    latencyMs: v.number(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Please sign in to register an agent.");
    const ownerId = identity.subject;

    const name = args.name.trim();
    if (!name) throw new Error("Agent name is required.");

    // Same rules the dialog uses, re-run here so the browser can't skip them
    const descCheck = validateDescription(args.description);
    if (!descCheck.ok) throw new Error(descCheck.message ?? "Invalid description.");
    const tagCheck = validateTags(args.tags);
    if (!tagCheck.ok) throw new Error(tagCheck.message ?? "Invalid tags.");

    const inputSchema = parseSchema(args.inputSchemaJson, "Input schema");
    const outputSchema = parseSchema(args.outputSchemaJson, "Output schema");
    const options = resolvePricing(inputSchema, outputSchema, args.tags);
    const planErrors = validatePlan(args.plan as PricingPlan, options, args.tags);
    if (planErrors.length > 0) throw new Error(planErrors[0]);

    const baseUrl = normaliseUrl(args.baseUrl);
    const dupe = await ctx.db
      .query("agents")
      .withIndex("by_baseUrl", (q) => q.eq("baseUrl", baseUrl))
      .first();
    if (dupe) throw new Error("Not allowed: this agent URL is already taken. Choose another.");
    await assertNameFree(ctx, name);

    const now = Date.now();
    const slug = await uniqueSlug(ctx, name);

    const agentId = await ctx.db.insert("agents", {
      ownerId,
      slug,
      name,
      nameKey: nameKeyOf(name),
      description: args.description.trim(),
      logoUrl: cleanLogoUrl(args.logoUrl),
      baseUrl,
      version: args.version,
      manifestAgentId: args.manifestAgentId,
      platform: args.platform,
      status: "active",
      tags: args.tags,
      models: args.models.map((m) => ({ id: m.id, provider: m.provider })),
      capabilities: args.capabilities,
      inputSchemaJson: args.inputSchemaJson,
      outputSchemaJson: args.outputSchemaJson,
      verification: {
        verifiedAt: now,
        latencyMs: args.latencyMs,
      },
      contractAcceptedAt: now,
      ratingAvg: 0,
      ratingCount: 0,
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.insert("agent_pricing", {
      agentId,
      plan: planToMicros(args.plan as PricingPlan),
      createdAt: now,
    });

    await Promise.all(
      args.tags.map((tagId) => ctx.db.insert("agent_tags", { agentId, tagId })),
    );

    return { agentId, slug, name };
  },
});

/** The signed-in creator's own agents (includes private pricing, so owner-only). */
export const listMine = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const agents = await ctx.db
      .query("agents")
      .withIndex("by_owner", (q) => q.eq("ownerId", identity.subject))
      .order("desc")
      .collect();

    return await Promise.all(
      agents.map(async (agent) => ({
        ...agent,
        // Newest row is the current price
        pricing: await ctx.db
          .query("agent_pricing")
          .withIndex("by_agent_created", (q) => q.eq("agentId", agent._id))
          .order("desc")
          .first(),
      })),
    );
  },
});

/** Owner-only: set or clear (omit logoUrl) the agent's logo. */
export const setLogo = mutation({
  args: { agentId: v.id("agents"), logoUrl: v.optional(v.string()) },
  handler: async (ctx, { agentId, logoUrl }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Please sign in.");

    const agent = await ctx.db.get(agentId);
    if (!agent || agent.ownerId !== identity.subject) throw new Error("Agent not found.");

    await ctx.db.patch(agentId, { logoUrl: cleanLogoUrl(logoUrl), updatedAt: Date.now() });
    return { agentId };
  },
});

/**
 * Owner-only edit from the agent sheet: description, key capabilities, and
 * active <-> paused. Suspended (marketplace) and archived (delete) are never set or lifted here.
 */
export const updateDetails = mutation({
  args: {
    agentId: v.id("agents"),
    /** New name; the slug (the agent's page address) follows it. Omit to keep the current name. */
    name: v.optional(v.string()),
    description: v.string(),
    status: v.optional(v.union(v.literal("active"), v.literal("paused"))),
    keyCapabilities: v.array(v.string()),
  },
  handler: async (ctx, { agentId, name, description, status, keyCapabilities }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Please sign in.");

    const agent = await ctx.db.get(agentId);
    if (!agent || agent.ownerId !== identity.subject) throw new Error("Agent not found.");

    const locked = agent.status === "suspended" || agent.status === "archived";
    if (locked && status) {
      throw new Error(`This agent is ${agent.status}; its status cannot be changed.`);
    }

    // Only a changed description is checked, so an older, shorter one never blocks an unrelated edit
    if (description.trim() !== agent.description) {
      const descCheck = validateDescription(description);
      if (!descCheck.ok) throw new Error(descCheck.message ?? "Invalid description.");
    }

    let rename: { name: string; slug: string; nameKey: string } | undefined;
    if (name !== undefined && name.trim() !== agent.name) {
      const clean = name.trim().replace(/\s+/g, " ");
      if (clean.length < 2) throw new Error("Agent name must be at least 2 characters.");
      if (clean.length > 60) throw new Error("Agent name must be 60 characters or fewer.");
      await assertNameFree(ctx, clean, agentId);
      rename = { name: clean, slug: await uniqueSlug(ctx, clean, agentId), nameKey: nameKeyOf(clean) };
    }

    await ctx.db.patch(agentId, {
      ...rename,
      description: description.trim(),
      ...(status && { status }),
      keyCapabilities: cleanCapabilities(keyCapabilities),
      updatedAt: Date.now(),
    });
    return { agentId };
  },
});

/** Archiving takes an agent off the marketplace. A daily job removes it for good (see purgeArchived). */
export const archive = mutation({
  args: { agentId: v.id("agents") },
  handler: async (ctx, { agentId }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Please sign in.");

    const agent = await ctx.db.get(agentId);
    if (!agent || agent.ownerId !== identity.subject) throw new Error("Agent not found.");
    if (agent.status === "archived") return { agentId };

    await ctx.db.patch(agentId, { status: "archived", updatedAt: Date.now() });
    return { agentId };
  },
});

/**
 * Every active agent as one lean row for the marketplace table: price, rating and run stats included.
 * Never returns the creator's private price floor. Sorting, search and paging happen in the browser.
 */
export const listMarketplace = query({
  args: {},
  handler: async (ctx) => {
    const agents = await ctx.db
      .query("agents")
      .withIndex("by_status", (q) => q.eq("status", "active"))
      .take(1000);
    return await Promise.all(
      agents.map(async (a) => {
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
        const fromMicros = !plan
          ? null
          : plan.shape === "per_run"
            ? plan.priceMicros
            : plan.shape === "per_unit"
              ? plan.pricePerUnitMicros
              : Math.min(...plan.tiers.map((t) => t.priceMicros));
        return {
          id: a._id as string,
          slug: a.slug,
          name: a.name,
          description: a.description,
          logoUrl: a.logoUrl ?? null,
          tags: a.tags,
          models: a.models,
          ratingAvg: a.ratingAvg ?? 0,
          ratingCount: a.ratingCount ?? 0,
          priceLabel: priceSummary(plan),
          priceMicros: fromMicros,
          totalRuns: stats?.totalRuns ?? 0,
          successRate: stats && stats.totalRuns > 0 ? Math.round((stats.successRuns / stats.totalRuns) * 100) : null,
          avgLatencyMs: stats && stats.totalRuns > 0 ? Math.round(stats.totalLatencyMs / stats.totalRuns) : null,
          createdAt: a.createdAt,
        };
      }),
    );
  },
});

/** Top 3 active agents for the Space home: highest rating first, ties go to the oldest. */
export const listFeatured = query({
  args: {},
  handler: async (ctx) => {
    const agents = await ctx.db
      .query("agents")
      .withIndex("by_status", (q) => q.eq("status", "active"))
      .collect();
    return agents
      .sort(
        (a, b) =>
          (b.ratingAvg ?? 0) - (a.ratingAvg ?? 0) || a.createdAt - b.createdAt,
      )
      .slice(0, 3)
      .map((a) => ({
        _id: a._id,
        slug: a.slug,
        name: a.name,
        logoUrl: a.logoUrl,
        tags: a.tags,
        models: a.models,
        ratingAvg: a.ratingAvg ?? 0,
      }));
  },
});

/** Owner-only: bring an archived agent back (it returns active) before the daily cleanup removes it. */
export const markActive = mutation({
  args: { agentId: v.id("agents") },
  handler: async (ctx, { agentId }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Please sign in.");

    const agent = await ctx.db.get(agentId);
    if (!agent || agent.ownerId !== identity.subject) throw new Error("Agent not found.");
    if (agent.status === "active") return { agentId };
    if (agent.status !== "archived") throw new Error(`This agent is ${agent.status}; only archived agents can be marked active.`);

    await ctx.db.patch(agentId, { status: "active", updatedAt: Date.now() });
    return { agentId };
  },
});

const ARCHIVE_GRACE_MS = 24 * 60 * 60 * 1000;
const PURGE_BATCH = 25;

/**
 * Daily cron: permanently remove agents archived for over 24 hours, so creators get a day to mark them active.
 * Run history, metrics and the revenue ledger are kept (financial / audit records); lists show them as "Deleted agent".
 * An agent that still has a run in flight is skipped until the next pass.
 */
export const purgeArchived = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - ARCHIVE_GRACE_MS;
    const stale = await ctx.db
      .query("agents")
      .withIndex("by_status_updated", (q) => q.eq("status", "archived").lt("updatedAt", cutoff))
      .take(PURGE_BATCH);

    let removed = 0;
    for (const agent of stale) {
      let busy = false;
      for (const status of ["awaiting_input", "queued", "running"] as const) {
        const live = await ctx.db
          .query("runs")
          .withIndex("by_agent_status", (q) => q.eq("agentId", agent._id).eq("status", status))
          .first();
        if (live) busy = true;
      }
      if (busy) continue;

      const children = await Promise.all([
        ctx.db.query("agent_pricing").withIndex("by_agent_created", (q) => q.eq("agentId", agent._id)).collect(),
        ctx.db.query("agent_tags").withIndex("by_agent", (q) => q.eq("agentId", agent._id)).collect(),
        ctx.db.query("agent_stats").withIndex("by_agent", (q) => q.eq("agentId", agent._id)).collect(),
        ctx.db.query("agent_stats_daily").withIndex("by_agent_day", (q) => q.eq("agentId", agent._id)).collect(),
        ctx.db.query("agent_callers_daily").withIndex("by_agent_day", (q) => q.eq("agentId", agent._id)).collect(),
        ctx.db.query("agent_reviews").withIndex("by_agent_created", (q) => q.eq("agentId", agent._id)).collect(),
        ctx.db.query("agent_regions_daily").withIndex("by_agent_day_region", (q) => q.eq("agentId", agent._id)).collect(),
        ctx.db.query("agent_latency_daily").withIndex("by_agent_day", (q) => q.eq("agentId", agent._id)).collect(),
        ctx.db.query("agent_errors_daily").withIndex("by_agent_day_code", (q) => q.eq("agentId", agent._id)).collect(),
      ]);
      for (const row of children.flat()) await ctx.db.delete(row._id);
      await ctx.db.delete(agent._id);
      removed++;
    }
    return { removed, skipped: stale.length - removed };
  },
});
