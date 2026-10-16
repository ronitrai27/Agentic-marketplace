import { query, mutation } from "./_generated/server";
import { components } from "./_generated/api";
import { authComponent } from "./betterAuth/auth";

export const getCurrentUser = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    return identity;
  },
});

export const getAuthUser = query({
  args: {},
  handler: async (ctx) => {
    try {
      return await authComponent.getAuthUser(ctx);
    } catch {
      return null;
    }
  },
});

import { v } from "convex/values";

export const completeOnboarding = mutation({
  args: {
    hearAboutUs: v.optional(v.string()),
    primaryUse: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Unauthorized");
    }

    const updateFields: Record<string, any> = {
      onboardingCompleted: true,
      updatedAt: Date.now(),
    };

    if (args.hearAboutUs !== undefined) {
      updateFields.hearAboutUs = args.hearAboutUs;
    }
    if (args.primaryUse !== undefined) {
      updateFields.primaryUse = args.primaryUse;
    }

    await (ctx as any).runMutation(components.betterAuth.adapter.updateOne, {
      input: {
        model: "user",
        where: [
          {
            field: "_id",
            value: identity.subject,
          },
        ],
        update: updateFields,
      },
    });

    return { success: true };
  },
});

