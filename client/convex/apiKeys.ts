import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

/**
 * Basic Convex backend for Creator API Keys
 * 
 * - Public Key: `cat_pub_live_...`
 * - Secret Key: `cat_sec_live_...`
 *   - Stored hashed via SHA-256 for zero-leak security
 *   - Only prefix preview displayed in UI
 */

export const getApiKeys = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return { publicKey: null, secretKeys: [] };
    }

    const userId = identity.subject;

    // Fetch user public key if exists, or generate a deterministic / stored one
    const publicKeys = await ctx.db
      .query("creator_public_keys")
      .filter((q) => q.eq(q.field("userId"), userId))
      .collect();

    const secretKeys = await ctx.db
      .query("creator_api_keys")
      .filter((q) => q.eq(q.field("userId"), userId))
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
        rateLimitRps: k.rateLimitRps,
        lastUsedAt: k.lastUsedAt,
        lastUsedIp: k.lastUsedIp,
        lastUsedRegion: k.lastUsedRegion,
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

    // Generate random hex string for live public key
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
    keyHash: v.string(),
    previewKey: v.string(),
    expiresAt: v.optional(v.number()), // timestamp ms or undefined for never
    allowedRegions: v.array(v.string()), // ['all'] or ['us-east', 'eu-west', etc.]
    allowedIps: v.array(v.string()), // ['192.168.1.1', ...]
    rateLimitRps: v.optional(v.number()),
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
      rateLimitRps: args.rateLimitRps ?? 100,
    });

    return { keyId };
  },
});

export const revokeSecretKey = mutation({
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

    await ctx.db.patch(args.keyId, {
      status: "revoked",
      revokedAt: Date.now(),
    });

    return { success: true };
  },
});
