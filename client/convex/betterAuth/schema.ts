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
});
