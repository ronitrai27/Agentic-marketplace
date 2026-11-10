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

  // ─── X-Marketplace-Key (exactly one per creator) ──────────────
  // Sent by the marketplace in the X-Marketplace-Key header when it calls the creator's
  // low/no-code agent (e.g. an n8n webhook). Shown to the creator again on request.
  creator_auth_keys: defineTable({
    userId: v.string(),
    rawKey: v.string(),
    /** Display form, e.g. "mak_live_••••••••4b12" */
    previewKey: v.string(),
    createdAt: v.number(),
    expiresAt: v.optional(v.number()),
    rotatedAt: v.optional(v.number()),
  }).index("by_userId", ["userId"]),

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
    /** Lowercased, whitespace-collapsed name: agent names are unique marketplace-wide. Missing on older rows. */
    nameKey: v.optional(v.string()),
    description: v.string(),
    /** Public R2 URL of the 256x256 logo; the UI falls back to the name's first letter. */
    logoUrl: v.optional(v.string()),
    baseUrl: v.string(), // unique, normalised (no trailing slash)
    version: v.string(),
    manifestAgentId: v.optional(v.string()),
    /** Set for agents built in a low/no-code platform: the marketplace POSTs the webhook directly with X-Marketplace-Key. */
    platform: v.optional(v.literal("n8n")),
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
    .index("by_nameKey", ["nameKey"])
    .index("by_status", ["status", "createdAt"])
    // Daily archive cleanup: archived agents older than the grace period
    .index("by_status_updated", ["status", "updatedAt"]),

  // Version history: one row per published version (the newest row is the current version).
  // Written by agents.reRegister; older agents get their first row backfilled on their first re-register.
  agent_versions: defineTable({
    agentId: v.id("agents"),
    version: v.string(),
    /** Schema snapshot taken when this version was published. */
    inputSchemaJson: v.string(),
    outputSchemaJson: v.string(),
    capabilities: v.optional(v.any()),
    /** Optional release note. */
    changelog: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_agent_created", ["agentId", "createdAt"])
    .index("by_agent_version", ["agentId", "version"]),

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

  // ─── Chef chats ────────────────────────────────────────────────────
  // Read model for the UI. The LangGraph checkpoint in Postgres is the execution truth; these rows are
  // written by a background outbox and never block the chat.
  chats: defineTable({
    chatId: v.string(), // uuid in the URL and the LangGraph thread id (namespaced by user there)
    userId: v.string(),
    title: v.string(),
    createdAt: v.number(),
    lastMessageAt: v.number(),
  })
    .index("by_chatId", ["chatId"])
    .index("by_user_last", ["userId", "lastMessageAt"]),

  chat_messages: defineTable({
    chatId: v.string(),
    userId: v.string(),
    /** Client/service generated uuid: makes a retried write a no-op. */
    messageId: v.string(),
    role: v.union(v.literal("user"), v.literal("assistant")),
    /** proposal = a run-approval card (see chat_runs); run_done = a run started from this chat has finished. */
    kind: v.union(v.literal("text"), v.literal("refusal"), v.literal("proposal"), v.literal("run_done")),
    text: v.string(),
    proposalId: v.optional(v.string()),
    runId: v.optional(v.string()),
    /** How long the chef took to answer, saved with the reply. */
    durationMs: v.optional(v.number()),
    createdAt: v.number(),
    /** Position inside one batch, to keep order when createdAt ties. */
    ord: v.number(),
  })
    .index("by_chat_order", ["chatId", "createdAt", "ord"])
    .index("by_chat_message", ["chatId", "messageId"]),

  // A chef run proposal: the human approves or denies it (HITL) before any credits are held.
  // The card and the runs it started are rebuilt from this row after a refresh.
  chat_runs: defineTable({
    chatId: v.string(),
    userId: v.string(),
    proposalId: v.string(),
    agents: v.array(
      v.object({
        agentId: v.id("agents"),
        slug: v.string(),
        name: v.string(),
        logoUrl: v.optional(v.string()),
        /** Most this run can cost: tiered plans hold their highest tier. */
        holdCredits: v.number(),
        tiered: v.boolean(),
      }),
    ),
    totalCredits: v.number(),
    status: v.union(v.literal("pending"), v.literal("approved"), v.literal("denied"), v.literal("expired")),
    runIds: v.array(v.id("runs")),
    createdAt: v.number(),
    expiresAt: v.number(),
    decidedAt: v.optional(v.number()),
  }).index("by_proposal", ["proposalId"]),

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
    /** Set when the chef started this run: its end is announced in that chat. */
    chatId: v.optional(v.string()),
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

  // ─── Creator analytics ─────────────────────────────────────────────
  // NEVER stores run input or output (buyer data is confidential): only who/where/how long/how much.
  // One immutable row per finished run. Source of truth for run-level tables and for rebuilding the rollups below.
  run_metrics: defineTable({
    runId: v.id("runs"),
    agentId: v.id("agents"),
    /** Agent owner, denormalised so a creator's whole portfolio is one index read. */
    ownerId: v.string(),
    callerId: v.string(),
    callerName: v.optional(v.string()),
    source: v.union(v.literal("key"), v.literal("session")),
    keyId: v.optional(v.id("creator_api_keys")),
    outcome: v.union(v.literal("succeeded"), v.literal("failed"), v.literal("cancelled")),
    /** Gateway error code on failure (e.g. "timeout", "schema_mismatch"); never the message body. */
    errorCode: v.optional(v.string()),
    /** Region/country as reported by the edge, and the raw caller IP for abuse review. */
    region: v.optional(v.string()),
    country: v.optional(v.string()),
    clientIp: v.optional(v.string()),
    /** Time spent waiting before the agent started, and the agent's own execution time. */
    queueMs: v.optional(v.number()),
    durationMs: v.number(),
    /** Charged to the buyer, in credits (100 = $1) and integer micro-USD. 0 for failed or cancelled runs. */
    costCredits: v.number(),
    costMicros: v.number(),
    pricingId: v.optional(v.id("agent_pricing")),
    agentVersion: v.optional(v.string()),
    day: v.string(), // UTC "2026-11-09"
    createdAt: v.number(),
    finishedAt: v.number(),
  })
    .index("by_run", ["runId"])
    .index("by_agent_finished", ["agentId", "finishedAt"])
    .index("by_owner_finished", ["ownerId", "finishedAt"])
    .index("by_agent_caller", ["agentId", "callerId", "finishedAt"])
    .index("by_agent_outcome", ["agentId", "outcome", "finishedAt"]),

  // Rollup: runs per agent, per day, per region. Feeds the "where are calls coming from" map.
  agent_regions_daily: defineTable({
    agentId: v.id("agents"),
    ownerId: v.string(),
    day: v.string(),
    region: v.string(), // "unknown" when the edge sent nothing
    totalRuns: v.number(),
    successRuns: v.number(),
    failedRuns: v.number(),
    totalLatencyMs: v.number(),
  })
    .index("by_agent_day_region", ["agentId", "day", "region"])
    .index("by_owner_day", ["ownerId", "day"]),

  // Rollup: latency distribution per agent per day, for p50/p95/p99 without scanning run_metrics.
  // Fixed bucket upper bounds (ms): 250, 500, 1000, 2000, 5000, 10000, 30000, 60000, 120000, +inf.
  agent_latency_daily: defineTable({
    agentId: v.id("agents"),
    day: v.string(),
    buckets: v.array(v.number()), // counts, same order as the bounds above
    maxLatencyMs: v.number(),
    totalQueueMs: v.number(),
    queuedRuns: v.number(),
  }).index("by_agent_day", ["agentId", "day"]),

  // Rollup: error codes per agent per day, so failures can be explained, not only counted.
  agent_errors_daily: defineTable({
    agentId: v.id("agents"),
    day: v.string(),
    errorCode: v.string(),
    count: v.number(),
  }).index("by_agent_day_code", ["agentId", "day", "errorCode"]),

  // ─── Creator revenue ───────────────────────────────────────────────
  // Append-only ledger: one row per settled run. Fee rates are SNAPSHOTTED on the row (basis points,
  // 100 bps = 1%) so a later rate change never rewrites history. All money is integer micro-USD.
  //   grossMicros      what the buyer was charged for the run
  //   commissionMicros marketplace commission (12% = 1200 bps) taken from gross
  //   platformFeeMicros extra 1% (100 bps) marketplace platform fee taken from gross
  //   creatorNetMicros grossMicros - commissionMicros - platformFeeMicros
  revenue_ledger: defineTable({
    runId: v.id("runs"),
    agentId: v.id("agents"),
    creatorId: v.string(),
    buyerId: v.string(),
    pricingId: v.optional(v.id("agent_pricing")),
    grossMicros: v.number(),
    commissionBps: v.number(),
    commissionMicros: v.number(),
    platformFeeBps: v.number(),
    platformFeeMicros: v.number(),
    creatorNetMicros: v.number(),
    /** pending: inside the dispute/clearing window. available: payable. paid: included in a payout. reversed: refunded. */
    status: v.union(
      v.literal("pending"),
      v.literal("available"),
      v.literal("paid"),
      v.literal("reversed"),
    ),
    /** When a pending row becomes available. */
    availableAt: v.number(),
    payoutId: v.optional(v.id("creator_payouts")),
    /** Set when status = reversed (refund or chargeback). */
    reversedAt: v.optional(v.number()),
    reversalReason: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_run", ["runId"])
    .index("by_creator_created", ["creatorId", "createdAt"])
    .index("by_agent_created", ["agentId", "createdAt"])
    .index("by_creator_status", ["creatorId", "status", "createdAt"])
    .index("by_status_available", ["status", "availableAt"])
    .index("by_payout", ["payoutId"]),

  // Rollup: a creator's earnings per agent per day, so the Revenue page never scans the ledger.
  creator_revenue_daily: defineTable({
    creatorId: v.string(),
    agentId: v.id("agents"),
    day: v.string(),
    settledRuns: v.number(),
    grossMicros: v.number(),
    commissionMicros: v.number(),
    platformFeeMicros: v.number(),
    creatorNetMicros: v.number(),
    reversedMicros: v.number(),
  })
    .index("by_creator_day", ["creatorId", "day"])
    .index("by_agent_day", ["agentId", "day"]),

  // Money paid out to the creator. A payout groups ledger rows (revenue_ledger.payoutId).
  creator_payouts: defineTable({
    creatorId: v.string(),
    amountMicros: v.number(),
    currency: v.literal("USD"),
    status: v.union(
      v.literal("requested"),
      v.literal("processing"),
      v.literal("paid"),
      v.literal("failed"),
    ),
    /** Payment provider's reference (transfer id); no bank details are stored here. */
    providerRef: v.optional(v.string()),
    failureReason: v.optional(v.string()),
    periodStart: v.number(),
    periodEnd: v.number(),
    requestedAt: v.number(),
    paidAt: v.optional(v.number()),
  })
    .index("by_creator_requested", ["creatorId", "requestedAt"])
    .index("by_status", ["status", "requestedAt"]),

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
