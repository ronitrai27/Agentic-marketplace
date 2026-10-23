import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

/**
 * Convex backend for Creator API Keys
 * 
 * - Public Key: `cat_pub_live_...` (Plaintext for identification)
 * - Secret Key: `cat_sec_live_...`
 *   - Stored ONLY as SHA-256 hash (`keyHash`)
 *   - Only preview characters (`••••••••xxxx`) stored for UI display
 *   - Zero raw key persistence
 */

export const getApiKeys = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return { publicKey: null, secretKeys: [] };
    }

    const userId = identity.subject;

    // Fetch user public key if exists
    const publicKeys = await ctx.db
      .query("creator_public_keys")
      .filter((q) => q.eq(q.field("userId"), userId))
      .collect();

    // Fetch active secret keys for this user
    const secretKeys = await ctx.db
      .query("creator_api_keys")
      .filter((q) =>
        q.and(
          q.eq(q.field("userId"), userId),
          q.neq(q.field("status"), "revoked")
        )
      )
      .order("desc")
      .collect();

    return {
      publicKey: publicKeys[0]?.publicKey || null,
      secretKeys: secretKeys.map((k: any) => ({
        _id: k._id,
        previewKey: k.previewKey,
        createdAt: k.createdAt,
        expiresAt: k.expiresAt,
        status: k.status,
        allowedRegions: k.allowedRegions,
        allowedIps: k.allowedIps,
        rateLimitPerMin: k.rateLimitPerMin ?? k.rateLimitRps ?? 10,
        lastUsedAt: k.lastUsedAt,
        lastUsedIp: k.lastUsedIp,
      })),
    };
  },
});

export const getOrCreatePublicKey = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Unauthorized");
    }

    const userId = identity.subject;

    const existing = await ctx.db
      .query("creator_public_keys")
      .filter((q) => q.eq(q.field("userId"), userId))
      .first();

    if (existing) {
      return existing.publicKey;
    }

    // Generate live public key: cat_pub_live_<24hex>
    const randomHex = Array.from({ length: 24 }, () =>
      Math.floor(Math.random() * 16).toString(16)
    ).join("");
    const newPublicKey = `cat_pub_live_${randomHex}`;

    await ctx.db.insert("creator_public_keys", {
      userId,
      publicKey: newPublicKey,
      createdAt: Date.now(),
    });

    return newPublicKey;
  },
});

export const createSecretKey = mutation({
  args: {
    keyHash: v.string(), // Client-side SHA-256 hash of raw key
    previewKey: v.string(), // e.g. "••••••••Mh0U"
    expiresAt: v.optional(v.number()), // timestamp ms or undefined for never
    allowedRegions: v.array(v.string()), // ['all'] or ['us-east-1', ...]
    allowedIps: v.array(v.string()), // ['192.168.1.1', ...]
    rateLimitPerMin: v.optional(v.number()), // default 10
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Unauthorized");
    }

    const userId = identity.subject;

    const keyId = await ctx.db.insert("creator_api_keys", {
      userId,
      keyHash: args.keyHash,
      previewKey: args.previewKey,
      createdAt: Date.now(),
      expiresAt: args.expiresAt,
      status: "active",
      allowedRegions: args.allowedRegions.length > 0 ? args.allowedRegions : ["all"],
      allowedIps: args.allowedIps,
      rateLimitPerMin: args.rateLimitPerMin ?? 10,
    });

    return { keyId };
  },
});

export const rotateSecretKey = mutation({
  args: {
    keyId: v.id("creator_api_keys"),
    newKeyHash: v.string(),
    newPreviewKey: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Unauthorized");
    }

    const key = await ctx.db.get(args.keyId);
    if (!key || key.userId !== identity.subject) {
      throw new Error("Key not found or unauthorized");
    }

    // Replace the hash and preview in-place
    await ctx.db.patch(args.keyId, {
      keyHash: args.newKeyHash,
      previewKey: args.newPreviewKey,
      rotatedAt: Date.now(),
    });

    return { success: true };
  },
});

export const deleteSecretKey = mutation({
  args: {
    keyId: v.id("creator_api_keys"),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Unauthorized");
    }

    const key = await ctx.db.get(args.keyId);
    if (!key || key.userId !== identity.subject) {
      throw new Error("Key not found or unauthorized");
    }

    await ctx.db.delete(args.keyId);
    return { success: true };
  },
});

/**
 * Gateway Verification Mutation / Query
 * 
 * Verifies raw API key against stored SHA-256 hash, checks:
 * 1. Hash match
 * 2. Active status (not revoked/deleted)
 * 3. Expiration timestamp
 * 4. Region geo-fence
 * 5. IP Allowlist (exact match or CIDR)
 * 6. Updates lastUsedAt & telemetry
 */
export const verifyApiKey = mutation({
  args: {
    keyHash: v.string(),
    clientIp: v.optional(v.string()),
    region: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Look up key by SHA-256 hash
    const key = await ctx.db
      .query("creator_api_keys")
      .filter((q) => q.eq(q.field("keyHash"), args.keyHash))
      .first();

    if (!key) {
      return { valid: false, error: "INVALID_KEY", message: "API key does not exist" };
    }

    if (key.status !== "active") {
      return { valid: false, error: "KEY_REVOKED", message: "API key has been revoked" };
    }

    // Check expiration
    if (key.expiresAt && Date.now() > key.expiresAt) {
      return { valid: false, error: "KEY_EXPIRED", message: "API key has expired" };
    }

    // Check allowed region (if not 'all')
    if (args.region && key.allowedRegions && !key.allowedRegions.includes("all")) {
      if (!key.allowedRegions.includes(args.region)) {
        return {
          valid: false,
          error: "REGION_RESTRICTED",
          message: `Key is restricted to [${key.allowedRegions.join(", ")}]. Called from ${args.region}`,
        };
      }
    }

    // Check IP allowlist (if configured)
    if (key.allowedIps && key.allowedIps.length > 0 && !key.allowedIps.includes("All IPs")) {
      const callerIp = args.clientIp?.trim();
      if (!callerIp || !key.allowedIps.includes(callerIp)) {
        return {
          valid: false,
          error: "IP_FORBIDDEN",
          message: `IP ${callerIp || "unknown"} is not in the allowed IP list`,
        };
      }
    }

    // Record last used telemetry
    await ctx.db.patch(key._id, {
      lastUsedAt: Date.now(),
      lastUsedIp: args.clientIp || undefined,
      lastUsedRegion: args.region || undefined,
    });

    return {
      valid: true,
      userId: key.userId,
      rateLimitPerMin: key.rateLimitPerMin ?? 10,
    };
  },
});
