import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * Root Convex Schema — Catelog App Tables
 *
 * BetterAuth component tables (user, session, account, verification, jwks)
 * are managed by the betterAuth component and do NOT live here.
 * They are registered via convex.config.ts → app.use(betterAuth).
 *
 * Security contract:
 *   creator_api_keys  → stores ONLY sha256(rawKey), never the raw key itself
 *   creator_public_keys → stores plaintext (safe to expose, read-only key)
 */
export default defineSchema({
  // ─── Publishable Key (one per creator workspace) ───────────────────
  creator_public_keys: defineTable({
    userId: v.string(),         // BetterAuth subject ID
    publicKey: v.string(),      // Full cat_pub_live_... key — safe to expose
    createdAt: v.number(),
  })
    .index("by_userId", ["userId"])
    .index("by_publicKey", ["publicKey"]),

  // ─── Secret API Keys (many per creator) ────────────────────────────
  creator_api_keys: defineTable({
    userId: v.string(),         // BetterAuth subject ID
    /**
     * SHA-256 hex of the raw key.
     * Raw key is NEVER stored — generated and hashed inside a Convex action.
     */
    keyHash: v.string(),
    /** UI display suffix e.g. "cat_sec_live_••••4b12" */
    previewKey: v.string(),
    createdAt: v.number(),
    expiresAt: v.optional(v.number()),
    status: v.union(v.literal("active"), v.literal("revoked")),
    /** ["all"] = no restriction; otherwise e.g. ["us-east-1"] */
    allowedRegions: v.array(v.string()),
    /** CIDR-capable IP allowlist. Empty = allow all. */
    allowedIps: v.array(v.string()),
    /** Gateway-enforced requests-per-minute ceiling */
    rateLimitPerMin: v.number(),
    rotatedAt: v.optional(v.number()),
    // Telemetry
    lastUsedAt: v.optional(v.number()),
    lastUsedIp: v.optional(v.string()),
    lastUsedRegion: v.optional(v.string()),
  })
    // HOT PATH: O(1) lookup during gateway verification
    .index("by_keyHash", ["keyHash"])
    // Dashboard list: O(1) by owner
    .index("by_userId", ["userId"])
    // Filtered active keys by owner
    .index("by_userId_status", ["userId", "status"]),

  // ─── Registered Agents (BYOS) ──────────────────────────────────────
  // Money is stored as integer micro-USD (1 = $0.000001), never floats.
  // JSON schemas are stored as strings: Convex field names cannot start with "$" or "_".
  agents: defineTable({
    ownerId: v.string(),        // BetterAuth subject ID
    slug: v.string(),           // unique, derived from name
    name: v.string(),
    description: v.string(),
    /** Public R2 URL of the 256x256 logo; the UI falls back to the name's first letter. */
    logoUrl: v.optional(v.string()),
    baseUrl: v.string(),        // unique, normalised (no trailing slash)
    version: v.string(),
    manifestAgentId: v.optional(v.string()),
    status: v.union(
      v.literal("active"),
      v.literal("paused"),
      v.literal("suspended"),
      v.literal("archived"),
    ),
    tags: v.array(v.string()),  // denormalised for display; filtering uses agent_tags
    /** Models seen during the dry run (auto-filled from telemetry). */
    models: v.array(
      v.object({
        id: v.string(),
        provider: v.optional(v.string()),
      }),
    ),
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
    verification: v.object({
      verifiedAt: v.number(),
      latencyMs: v.number(),
    }),
    contractAcceptedAt: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_owner", ["ownerId"])
    .index("by_slug", ["slug"])
    .index("by_baseUrl", ["baseUrl"])
    .index("by_status", ["status", "createdAt"]),

  // Join table so the marketplace can filter by tag (Convex cannot index arrays)
  agent_tags: defineTable({
    agentId: v.id("agents"),
    tagId: v.string(),
  })
    .index("by_tag", ["tagId"])
    .index("by_agent", ["agentId"]),

  // Append-only price history. The newest row is the current price;
  // billing records reference the row a run was charged under.
  agent_pricing: defineTable({
    agentId: v.id("agents"),
    plan: v.union(
      v.object({
        shape: v.literal("per_run"),
        priceMicros: v.number(),
        /** Creator's private floor. NEVER return this from buyer-facing queries. */
        negotiation: v.optional(v.object({ minPriceMicros: v.number() })),
      }),
      v.object({
        shape: v.literal("per_unit"),
        unitLabel: v.string(),
        countKey: v.string(),
        outputKey: v.string(),
        pricePerUnitMicros: v.number(),
        minChargeMicros: v.number(),
        maxUnitsPerRun: v.optional(v.number()),
      }),
      v.object({
        shape: v.literal("tiered"),
        fieldKey: v.string(),
        tiers: v.array(v.object({ value: v.string(), priceMicros: v.number() })),
      }),
    ),
    createdAt: v.number(),
  }).index("by_agent_created", ["agentId", "createdAt"]),

  // ─── Rate Limit Sliding Window ──────────────────────────────────────
  // One document per (keyId, windowMinute). TTL-cleaned by a scheduled job.
  api_key_rate_windows: defineTable({
    keyId: v.string(),          // creator_api_keys._id as string
    /** Unix minute bucket: Math.floor(Date.now() / 60_000) */
    windowMinute: v.number(),
    /** Number of requests in this 1-minute window */
    count: v.number(),
    /** Absolute ms timestamp — lets a scheduled job purge old rows */
    expiresAt: v.number(),
  })
    .index("by_keyId_window", ["keyId", "windowMinute"])
    .index("by_expiresAt", ["expiresAt"]),
});
