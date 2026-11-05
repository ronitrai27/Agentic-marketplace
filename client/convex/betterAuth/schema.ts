import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  user: defineTable({
    name: v.string(),
    email: v.string(),
    emailVerified: v.boolean(),
    image: v.optional(v.union(v.string(), v.null())),
    createdAt: v.number(),
    updatedAt: v.number(),
    userId: v.optional(v.union(v.string(), v.null())),
    onboardingCompleted: v.optional(v.boolean()),
    hearAboutUs: v.optional(v.string()),
    primaryUse: v.optional(v.string()),
    credits: v.optional(v.number()),
  }).index("email", ["email"]),

  session: defineTable({
    expiresAt: v.number(),
    token: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
    ipAddress: v.optional(v.union(v.string(), v.null())),
    userAgent: v.optional(v.union(v.string(), v.null())),
    userId: v.string(),
  })
    .index("token", ["token"])
    .index("userId", ["userId"]),

  account: defineTable({
    accountId: v.string(),
    providerId: v.string(),
    userId: v.string(),
    accessToken: v.optional(v.union(v.string(), v.null())),
    refreshToken: v.optional(v.union(v.string(), v.null())),
    idToken: v.optional(v.union(v.string(), v.null())),
    accessTokenExpiresAt: v.optional(v.union(v.number(), v.null())),
    refreshTokenExpiresAt: v.optional(v.union(v.number(), v.null())),
    scope: v.optional(v.union(v.string(), v.null())),
    password: v.optional(v.union(v.string(), v.null())),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("accountId", ["accountId"])
    .index("userId", ["userId"]),

  verification: defineTable({
    identifier: v.string(),
    value: v.string(),
    expiresAt: v.number(),
    createdAt: v.optional(v.union(v.number(), v.null())),
    updatedAt: v.optional(v.union(v.number(), v.null())),
  }).index("identifier", ["identifier"]),

  jwks: defineTable({
    publicKey: v.string(),
    privateKey: v.string(),
    createdAt: v.number(),
    expiresAt: v.optional(v.union(v.number(), v.null())),
  }),

  // ── OAuth provider tables (better-auth `mcp` plugin) ───────────────────────
  oauthApplication: defineTable({
    name: v.string(),
    icon: v.optional(v.union(v.string(), v.null())),
    metadata: v.optional(v.union(v.string(), v.null())),
    clientId: v.string(),
    clientSecret: v.optional(v.union(v.string(), v.null())),
    redirectUrls: v.string(),
    type: v.string(),
    disabled: v.optional(v.union(v.boolean(), v.null())),
    userId: v.optional(v.union(v.string(), v.null())),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("clientId", ["clientId"])
    .index("userId", ["userId"]),

  oauthAccessToken: defineTable({
    accessToken: v.string(),
    refreshToken: v.string(),
    accessTokenExpiresAt: v.number(),
    refreshTokenExpiresAt: v.number(),
    clientId: v.string(),
    userId: v.optional(v.union(v.string(), v.null())),
    scopes: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("accessToken", ["accessToken"])
    .index("refreshToken", ["refreshToken"])
    .index("clientId", ["clientId"])
    .index("userId", ["userId"]),

  oauthConsent: defineTable({
    clientId: v.string(),
    userId: v.string(),
    scopes: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
    consentGiven: v.boolean(),
  })
    .index("clientId_userId", ["clientId", "userId"])
    .index("userId", ["userId"]),
});
