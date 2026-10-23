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
