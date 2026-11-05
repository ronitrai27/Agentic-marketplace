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
    userId: v.string(), // BetterAuth subject ID
    publicKey: v.string(), // Full cat_pub_live_... key — safe to expose
    createdAt: v.number(),
  })
    .index("by_userId", ["userId"])
    .index("by_publicKey", ["publicKey"]),

  // ─── Secret API Keys (many per creator) ────────────────────────────
  creator_api_keys: defineTable({
    userId: v.string(), // BetterAuth subject ID
    /**
     * SHA-256 hex of the raw key.
     * Raw key is NEVER stored — generated and hashed inside a Convex action.
     */
    keyHash: v.string(),
    /** UI display suffix e.g. "cat_sec_live_••••4b12" */
    previewKey: v.string(),
    /**
     * RSA-OAEP copy of the key, sealed to the run worker's public key. Convex cannot read it back; only the
     * worker can open it, to sign requests to the creator's agents. Never shown to the creator again.
     */
    sealed: v.optional(v.string()),
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
    ownerId: v.string(), // BetterAuth subject ID
    slug: v.string(), // unique, derived from name
    name: v.string(),
    description: v.string(),
    /** Public R2 URL of the 256x256 logo; the UI falls back to the name's first letter. */
    logoUrl: v.optional(v.string()),
    baseUrl: v.string(), // unique, normalised (no trailing slash)
    version: v.string(),
    manifestAgentId: v.optional(v.string()),
    status: v.union(
      v.literal("active"),
      v.literal("paused"),
      v.literal("suspended"),
      v.literal("archived"),
    ),
    tags: v.array(v.string()), // denormalised for display; filtering uses agent_tags
    /** Short bullet points the creator adds after registering; shown in the agent sheet. */
    keyCapabilities: v.optional(v.array(v.string())),
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
        /** SDK `limits.maxConcurrent`: the gateway refuses runs past this many in flight. */
        max_concurrent: v.optional(v.number()),
        /** SDK `limits.rateLimit`, normalised to requests per minute. */
        rate_limit_per_min: v.optional(v.number()),
      }),
    ),
    inputSchemaJson: v.string(),
    outputSchemaJson: v.string(),
    verification: v.object({
      verifiedAt: v.number(),
      latencyMs: v.number(),
    }),
    contractAcceptedAt: v.number(),
    /** Star rating (0 until buyer reviews exist). Missing = 0. Reviews will live in their own table. */
    ratingAvg: v.optional(v.number()),
    ratingCount: v.optional(v.number()),
    /** Consecutive failed /health checks across runs. Reaching the limit pauses the agent. */
    healthFailures: v.optional(v.number()),
    /** Which of the owner's secret keys this agent verifies against, learned from the first run that works. */
    signingKeyId: v.optional(v.id("creator_api_keys")),
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
        tiers: v.array(
          v.object({ value: v.string(), priceMicros: v.number() }),
        ),
      }),
    ),
    createdAt: v.number(),
  }).index("by_agent_created", ["agentId", "createdAt"]),

  // Running counters, one row per agent. Kept apart from `agents` so every run's write
  // doesn't re-trigger queries that read the agent. Average latency = totalLatencyMs / totalRuns.
  agent_stats: defineTable({
    agentId: v.id("agents"),
    totalRuns: v.number(),
    successRuns: v.number(),
    failedRuns: v.number(),
    /** Sum of latency over ALL runs (success and failed). */
    totalLatencyMs: v.number(),
    lastRunAt: v.optional(v.number()),
    updatedAt: v.number(),
  }).index("by_agent", ["agentId"]),

  // One review per (agent, user). Name and avatar are snapshotted when written.
  agent_reviews: defineTable({
    agentId: v.id("agents"),
    userId: v.string(), // BetterAuth subject ID
    userName: v.string(),
    userAvatar: v.optional(v.string()),
    rating: v.number(), // 1–5
    comment: v.string(),
    /** Like counter only; who liked is not stored. Missing = 0. */
    likes: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.optional(v.number()),
  })
    .index("by_agent_created", ["agentId", "createdAt"])
    .index("by_agent_user", ["agentId", "userId"]),

  // For daily stats store.
  agent_stats_daily: defineTable({
    agentId: v.id("agents"),
    day: v.string(), // "2026-11-02" (UTC)
    totalRuns: v.number(),
    successRuns: v.number(),
    failedRuns: v.number(),
    totalLatencyMs: v.number(),
  }).index("by_agent_day", ["agentId", "day"]),

  // Daily per-caller usage of an agent (creator analytics: who is calling, how often, how well).
  agent_callers_daily: defineTable({
    agentId: v.id("agents"),
    userId: v.string(),
    day: v.string(), // UTC
    userName: v.optional(v.string()),
    userAvatar: v.optional(v.string()),
    lastIp: v.optional(v.string()),
    lastRegion: v.optional(v.string()),
    totalRuns: v.number(),
    successRuns: v.number(),
    failedRuns: v.number(),
    totalLatencyMs: v.number(),
  })
    .index("by_agent_day", ["agentId", "day"])
    .index("by_agent_day_user", ["agentId", "day", "userId"]),

  // ─── Gateway runs ──────────────────────────────────────────────────
  // One row per accepted run. The Temporal workflow (id = "run-<runId>") owns its lifecycle
  // and reports back through /worker/run-status. Never holds the agent's baseUrl.
  runs: defineTable({
    agentId: v.id("agents"),
    userId: v.string(), // caller: BetterAuth subject ID
    source: v.union(v.literal("key"), v.literal("session")),
    keyId: v.optional(v.id("creator_api_keys")),
    status: v.union(
      v.literal("awaiting_input"), // payment held, waiting for the buyer to fill the input form
      v.literal("queued"),
      v.literal("running"),
      v.literal("succeeded"),
      v.literal("failed"),
      v.literal("cancelled"),
    ),
    inputJson: v.string(),
    /** Big inputs (uploaded files as base64) live in file storage, not in this row. Deleted when the run ends. */
    inputStorageId: v.optional(v.id("_storage")),
    inputLarge: v.optional(v.boolean()),
    /** Escrow in credits (100 credits = $1). Counts against the buyer's wallet until settled or released. */
    holdCredits: v.optional(v.number()),
    holdStatus: v.optional(v.union(v.literal("held"), v.literal("settled"), v.literal("released"))),
    chargedCredits: v.optional(v.number()),
    workflowId: v.optional(v.string()),
    /** Resolved at admission: agent's max_timeout_seconds, else the gateway default. */
    timeoutSeconds: v.number(),
    error: v.optional(v.object({ code: v.string(), message: v.string() })),
    createdAt: v.number(),
    startedAt: v.optional(v.number()),
    finishedAt: v.optional(v.number()),
    /** Latest `task.progress` percent from the agent (0-100), for live progress bars. */
    progressPct: v.optional(v.number()),
    /** What the agent returned (schema-checked), kept for the Output tab. Clipped, see MAX_OUTPUT_CHARS. */
    // ─── Trace: who called, from where, how long it took ───
    callerName: v.optional(v.string()),
    callerAvatar: v.optional(v.string()),
    clientIp: v.optional(v.string()),
    /** Region/country as far as the edge told us (header or geo header). */
    clientRegion: v.optional(v.string()),
    /** Total wall time from admission to the final status. */
    durationMs: v.optional(v.number()),
  })
    .index("by_agent_status", ["agentId", "status"])
    .index("by_user_created", ["userId", "createdAt"])
    .index("by_user_hold", ["userId", "holdStatus"])
    .index("by_status_created", ["status", "createdAt"]),

  // What the agent returned, kept apart from `runs` so lists of runs never load large outputs.
  run_outputs: defineTable({
    runId: v.id("runs"),
    outputJson: v.string(), // clipped, see MAX_OUTPUT_CHARS
  }).index("by_run", ["runId"]),

  // Live feed of what the agent emitted (SSE events) plus gateway notes, so a reload loses nothing.
  run_events: defineTable({
    runId: v.id("runs"),
    seq: v.number(),
    type: v.string(), // "task.progress", "task.delta", "health", "schema.check", ...
    dataJson: v.string(), // clipped, see MAX_EVENT_CHARS
    at: v.number(),
  }).index("by_run_seq", ["runId", "seq"]),

  // ─── Rate Limit Sliding Window ──────────────────────────────────────
  // One document per (keyId, windowMinute). TTL-cleaned by a scheduled job.
  api_key_rate_windows: defineTable({
    keyId: v.string(), // creator_api_keys._id as string
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
