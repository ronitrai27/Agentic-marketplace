"use node";

import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";

// ─────────────────────────────────────────────────────────────────────────────
//  Node.js actions — require "use node" because they use node:crypto.
//  Kept in a separate file from apiKeys.ts so that queries/mutations
//  in that file continue to run in the standard Convex (V8) runtime.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get or lazily create a creator's public API key.
 * Uses crypto.randomBytes server-side — never exposes raw entropy to the browser.
 */
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

    // Generate cryptographically secure public key server-side
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

/**
 * Generate a new secret API key.
 * All crypto (randomBytes + SHA-256 hash) runs server-side.
 * The raw key is returned ONCE to the caller and never stored.
 */
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

    const { randomBytes, createHash } = await import("node:crypto");

    // 32 bytes = 64 hex chars — 256 bits of entropy
    const rawSuffix = randomBytes(32).toString("hex");
    const rawKey = `cat_sec_live_${rawSuffix}`;

    // Preview: show prefix + last 4 hex chars only
    const previewKey = `cat_sec_live_••••••••${rawSuffix.slice(-4)}`;

    // Hash computed server-side, never by the browser
    const keyHash = createHash("sha256").update(rawKey).digest("hex");

    // Store via internalMutation — client can never call this directly
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

/**
 * Rotate an existing secret key.
 * Revokes the old hash and stores a freshly generated one.
 */
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
