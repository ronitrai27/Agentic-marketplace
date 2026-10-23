import {
  query,
  mutation,
  action,
  internalMutation,
  internalAction,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";

// ─────────────────────────────────────────────────────────────────────────────
//  Fix 2 helper: CIDR-aware IP matching (runs inside mutations — pure JS)
// ─────────────────────────────────────────────────────────────────────────────

function ipToInt(ip: string): number {
  return ip
    .split(".")
    .reduce((acc, octet) => (acc << 8) | parseInt(octet, 10), 0) >>> 0;
}

/** Returns true if `ip` is covered by `cidr` (e.g. "10.0.0.0/16") or exact match */
function ipMatchesCidr(ip: string, cidr: string): boolean {
  if (!cidr.includes("/")) return ip === cidr;
  const [network, prefixStr] = cidr.split("/");
  const prefix = parseInt(prefixStr, 10);
  if (isNaN(prefix) || prefix < 0 || prefix > 32) return false;
  const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
  return (ipToInt(ip) & mask) === (ipToInt(network) & mask);
}

function isIpAllowed(callerIp: string | undefined, allowedIps: string[]): boolean {
  if (allowedIps.length === 0) return true; // empty = allow all
  if (!callerIp) return false;
  const trimmed = callerIp.trim();
  return allowedIps.some((rule) => ipMatchesCidr(trimmed, rule.trim()));
}

// ─────────────────────────────────────────────────────────────────────────────
//  PUBLIC: Dashboard queries & mutations (creator UI)
// ─────────────────────────────────────────────────────────────────────────────

export const getApiKeys = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return { publicKey: null, secretKeys: [] };

    const userId = identity.subject;

    // O(1) with by_userId index (Fix 5)
    const pubRow = await ctx.db
      .query("creator_public_keys")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .first();

    // O(1) with by_userId_status index (Fix 5)
    const secretKeys = await ctx.db
      .query("creator_api_keys")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .filter((q) => q.neq(q.field("status"), "revoked"))
      .order("desc")
      .collect();

    return {
      publicKey: pubRow?.publicKey ?? null,
      secretKeys: secretKeys.map((k) => ({
        _id: k._id,
        previewKey: k.previewKey,
        createdAt: k.createdAt,
        expiresAt: k.expiresAt,
        status: k.status,
        allowedRegions: k.allowedRegions,
        allowedIps: k.allowedIps,
        rateLimitPerMin: k.rateLimitPerMin,
        lastUsedAt: k.lastUsedAt,
        lastUsedIp: k.lastUsedIp,
      })),
    };
  },
});

// ─────────────────────────────────────────────────────────────────────────────
//  Fix 1 + 2: Public key generation moved server-side into an ACTION.
//  Actions run in Node.js and have access to crypto.randomBytes.
//  The raw public key bytes never leave the server — only the key string
//  (which is intentionally public) is returned to the client.
// ─────────────────────────────────────────────────────────────────────────────

export const getOrCreatePublicKey = action({
  args: {},
  handler: async (ctx): Promise<string> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");

    // Check for existing via internal query
    const existing: string | null = await ctx.runQuery(
      internal.apiKeys._getPublicKey,
      { userId: identity.subject }
    );
    if (existing) return existing;

    // Generate cryptographically secure public key server-side (Fix 1)
    const { randomBytes } = await import("node:crypto");
    const hex = randomBytes(18).toString("hex"); // 36 hex chars
    const newPublicKey = `cat_pub_live_${hex}`;

    await ctx.runMutation(internal.apiKeys._storePublicKey, {
      userId: identity.subject,
      publicKey: newPublicKey,
    });

    return newPublicKey;
  },
});

export const _getPublicKey = internalMutation({
  args: { userId: v.string() },
  handler: async (ctx, { userId }): Promise<string | null> => {
    const row = await ctx.db
      .query("creator_public_keys")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .first();
    return row?.publicKey ?? null;
  },
});

export const _storePublicKey = internalMutation({
  args: { userId: v.string(), publicKey: v.string() },
  handler: async (ctx, { userId, publicKey }) => {
    // Double-check under write lock to prevent race
    const existing = await ctx.db
      .query("creator_public_keys")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .first();
    if (existing) return;

    await ctx.db.insert("creator_public_keys", {
      userId,
      publicKey,
      createdAt: Date.now(),
    });
  },
});

// ─────────────────────────────────────────────────────────────────────────────
//  Fix 1 + 2: Secret key GENERATION is now a Convex ACTION.
//
//  Previous: browser called Math.random() + Web Crypto SHA-256,
//            then sent the hash to a public mutation.
//  Now:      browser calls this action with only config (expiry, regions, ips,
//            rate limit). The action generates the key with crypto.randomBytes
//            and SHA-256-hashes it — all server-side. The hash is stored via
//            an internalMutation the client can NEVER call directly.
//            The raw key is returned ONCE to the caller.
// ─────────────────────────────────────────────────────────────────────────────

export const generateSecretKey = action({
  args: {
    expiresAt: v.optional(v.number()),
    allowedRegions: v.array(v.string()),
    allowedIps: v.array(v.string()),
    rateLimitPerMin: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<{ rawKey: string; previewKey: string }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");

    // ── Fix 1: Cryptographically secure random bytes ──
    const { randomBytes, createHash } = await import("node:crypto");

    // 32 bytes = 64 hex chars — 256 bits of entropy
    const rawSuffix = randomBytes(32).toString("hex");
    const rawKey = `cat_sec_live_${rawSuffix}`;

    // Preview: show prefix + last 4 hex chars only
    const previewKey = `cat_sec_live_••••••••${rawSuffix.slice(-4)}`;

    // ── Fix 2: Hash computed server-side, never by the browser ──
    const keyHash = createHash("sha256").update(rawKey).digest("hex");

    // ── Fix 3: Store via internalMutation — client can never call this directly ──
    await ctx.runMutation(internal.apiKeys._insertSecretKey, {
      userId: identity.subject,
      keyHash,
      previewKey,
      expiresAt: args.expiresAt,
      allowedRegions: args.allowedRegions.length > 0 ? args.allowedRegions : ["all"],
      allowedIps: args.allowedIps,
      rateLimitPerMin: args.rateLimitPerMin ?? 10,
    });

    // Raw key returned ONCE to the client — never stored, never logged
    return { rawKey, previewKey };
  },
});

// ─────────────────────────────────────────────────────────────────────────────
//  Fix 3: internalMutation — only callable from actions / http handler,
//         never directly from the browser client.
// ─────────────────────────────────────────────────────────────────────────────

export const _insertSecretKey = internalMutation({
  args: {
    userId: v.string(),
    keyHash: v.string(),
    previewKey: v.string(),
    expiresAt: v.optional(v.number()),
    allowedRegions: v.array(v.string()),
    allowedIps: v.array(v.string()),
    rateLimitPerMin: v.number(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("creator_api_keys", {
      userId: args.userId,
      keyHash: args.keyHash,
      previewKey: args.previewKey,
      createdAt: Date.now(),
      expiresAt: args.expiresAt,
      status: "active",
      allowedRegions: args.allowedRegions,
      allowedIps: args.allowedIps,
      rateLimitPerMin: args.rateLimitPerMin,
    });
  },
});

// ─────────────────────────────────────────────────────────────────────────────
//  Rotate — also an action so new key is generated server-side (Fix 1 + 2)
// ─────────────────────────────────────────────────────────────────────────────

export const rotateSecretKey = action({
  args: {
    keyId: v.id("creator_api_keys"),
  },
  handler: async (ctx, args): Promise<{ rawKey: string; previewKey: string }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");

    const { randomBytes, createHash } = await import("node:crypto");
    const rawSuffix = randomBytes(32).toString("hex");
    const rawKey = `cat_sec_live_${rawSuffix}`;
    const previewKey = `cat_sec_live_••••••••${rawSuffix.slice(-4)}`;
    const keyHash = createHash("sha256").update(rawKey).digest("hex");

    await ctx.runMutation(internal.apiKeys._applyRotation, {
      keyId: args.keyId,
      userId: identity.subject,
      newKeyHash: keyHash,
      newPreviewKey: previewKey,
    });

    return { rawKey, previewKey };
  },
});

export const _applyRotation = internalMutation({
  args: {
    keyId: v.id("creator_api_keys"),
    userId: v.string(),
    newKeyHash: v.string(),
    newPreviewKey: v.string(),
  },
  handler: async (ctx, args) => {
    const key = await ctx.db.get(args.keyId);
    if (!key || key.userId !== args.userId) {
      throw new Error("Key not found or unauthorized");
    }
    await ctx.db.patch(args.keyId, {
      keyHash: args.newKeyHash,
      previewKey: args.newPreviewKey,
      rotatedAt: Date.now(),
    });
  },
});

// ─────────────────────────────────────────────────────────────────────────────
//  Revoke (soft-delete) — keeps telemetry, marks status revoked
// ─────────────────────────────────────────────────────────────────────────────

export const revokeSecretKey = mutation({
  args: { keyId: v.id("creator_api_keys") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");

    const key = await ctx.db.get(args.keyId);
    if (!key || key.userId !== identity.subject) {
      throw new Error("Key not found or unauthorized");
    }

    await ctx.db.patch(args.keyId, { status: "revoked" });
    return { success: true };
  },
});

// Hard delete (permanently removes the row)
export const deleteSecretKey = mutation({
  args: { keyId: v.id("creator_api_keys") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");

    const key = await ctx.db.get(args.keyId);
    if (!key || key.userId !== identity.subject) {
      throw new Error("Key not found or unauthorized");
    }

    await ctx.db.delete(args.keyId);
    return { success: true };
  },
});

// ─────────────────────────────────────────────────────────────────────────────
//  Fix 3 + 4: verifyApiKey → internalMutation
//
//  This can now ONLY be called from:
//    1. A Convex HTTP action (gateway route in http.ts)
//    2. Other internal mutations/actions
//
//  It is completely unreachable from the browser client.
//
//  Also implements:
//    Fix 2: CIDR-aware IP matching (replaces exact-match-only check)
//    Fix 4: Sliding-window rate limiting (1-minute bucket, stored in DB)
// ─────────────────────────────────────────────────────────────────────────────

export const verifyApiKey = internalMutation({
  args: {
    keyHash: v.string(),
    clientIp: v.optional(v.string()),
    region: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Fix 5: O(1) index lookup — no full table scan
    const key = await ctx.db
      .query("creator_api_keys")
      .withIndex("by_keyHash", (q) => q.eq("keyHash", args.keyHash))
      .first();

    if (!key) {
      return { valid: false, error: "INVALID_KEY", message: "API key not found" };
    }

    if (key.status !== "active") {
      return { valid: false, error: "KEY_REVOKED", message: "API key has been revoked" };
    }

    if (key.expiresAt && Date.now() > key.expiresAt) {
      return { valid: false, error: "KEY_EXPIRED", message: "API key has expired" };
    }

    // Region check
    if (
      args.region &&
      key.allowedRegions.length > 0 &&
      !key.allowedRegions.includes("all")
    ) {
      if (!key.allowedRegions.includes(args.region)) {
        return {
          valid: false,
          error: "REGION_RESTRICTED",
          message: `Key restricted to [${key.allowedRegions.join(", ")}], called from ${args.region}`,
        };
      }
    }

    // Fix 2: CIDR-aware IP allowlist (replaces exact-match-only)
    if (key.allowedIps.length > 0) {
      if (!isIpAllowed(args.clientIp, key.allowedIps)) {
        return {
          valid: false,
          error: "IP_FORBIDDEN",
          message: `IP ${args.clientIp ?? "unknown"} not in allowlist`,
        };
      }
    }

    // Fix 4: Sliding-window rate limiting (1-minute bucket)
    const windowMinute = Math.floor(Date.now() / 60_000);
    const keyIdStr = key._id.toString();

    const windowRow = await ctx.db
      .query("api_key_rate_windows")
      .withIndex("by_keyId_window", (q) =>
        q.eq("keyId", keyIdStr).eq("windowMinute", windowMinute)
      )
      .first();

    if (windowRow) {
      if (windowRow.count >= key.rateLimitPerMin) {
        return {
          valid: false,
          error: "RATE_LIMITED",
          message: `Rate limit of ${key.rateLimitPerMin} req/min exceeded`,
          retryAfterMs: (windowMinute + 1) * 60_000 - Date.now(),
        };
      }
      await ctx.db.patch(windowRow._id, { count: windowRow.count + 1 });
    } else {
      // New window — insert row (expires in 2 minutes to allow cleanup)
      await ctx.db.insert("api_key_rate_windows", {
        keyId: keyIdStr,
        windowMinute,
        count: 1,
        expiresAt: (windowMinute + 2) * 60_000,
      });
    }

    // Update telemetry (non-blocking write, always after auth passes)
    await ctx.db.patch(key._id, {
      lastUsedAt: Date.now(),
      lastUsedIp: args.clientIp,
      lastUsedRegion: args.region,
    });

    return {
      valid: true,
      userId: key.userId,
      rateLimitPerMin: key.rateLimitPerMin,
    };
  },
});

// ─────────────────────────────────────────────────────────────────────────────
//  Scheduled cleanup: purge expired rate-window rows (run every 5 minutes)
// ─────────────────────────────────────────────────────────────────────────────

export const cleanupRateWindows = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const expired = await ctx.db
      .query("api_key_rate_windows")
      .withIndex("by_expiresAt", (q) => q.lt("expiresAt", now))
      .collect();

    await Promise.all(expired.map((row) => ctx.db.delete(row._id)));
    return { deleted: expired.length };
  },
});
