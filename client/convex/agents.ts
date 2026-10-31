import { mutation, query, type MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import { validateTags } from "../src/lib/agent-tags";
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

async function uniqueSlug(ctx: MutationCtx, name: string): Promise<string> {
  const base = slugify(name);
  for (let i = 1; i <= 50; i++) {
    const candidate = i === 1 ? base : `${base}-${i}`;
    const taken = await ctx.db
      .query("agents")
      .withIndex("by_slug", (q) => q.eq("slug", candidate))
      .first();
    if (!taken) return candidate;
  }
  return `${base}-${Date.now().toString(36)}`;
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

export const register = mutation({
  args: {
    name: v.string(),
    description: v.string(),
    baseUrl: v.string(),
    version: v.string(),
    manifestAgentId: v.optional(v.string()),
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
    if (dupe) throw new Error("An agent with this URL is already registered.");

    const now = Date.now();
    const slug = await uniqueSlug(ctx, name);

    const agentId = await ctx.db.insert("agents", {
      ownerId,
      slug,
      name,
      description: args.description.trim(),
      baseUrl,
      version: args.version,
      manifestAgentId: args.manifestAgentId,
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

/** Agents are never hard-deleted (policy): archiving takes them off the marketplace. */
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
