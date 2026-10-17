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

export const checkEmailAuthMethods = query({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    const email = args.email.trim().toLowerCase();
    if (!email) {
      return { exists: false, providers: [], hasPassword: false, name: null };
    }

    try {
      const user = await (ctx as any).runQuery(
        components.betterAuth.adapter.findOne,
        {
          model: "user",
          where: [{ field: "email", value: email }],
        },
      );

      if (!user) {
        return { exists: false, providers: [], hasPassword: false, name: null };
      }

      const userId = user._id || user.id;
      const accounts = await (ctx as any).runQuery(
        components.betterAuth.adapter.findMany,
        {
          model: "account",
          where: [{ field: "userId", value: userId }],
        },
      );

      const providers = (accounts || []).map((acc: any) => acc.providerId);
      return {
        exists: true,
        name: user.name || null,
        providers,
        hasPassword: providers.includes("credential"),
      };
    } catch (e) {
      console.error("Error checking email auth methods:", e);
      return { exists: false, providers: [], hasPassword: false, name: null };
    }
  },
});

export const getUserAuthStatus = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return null;
    }

    try {
      const user = await (ctx as any).runQuery(
        components.betterAuth.adapter.findOne,
        {
          model: "user",
          where: [{ field: "_id", value: identity.subject }],
        },
      );

      if (!user) {
        return null;
      }

      const userId = user._id || user.id || identity.subject;
      const accounts = await (ctx as any).runQuery(
        components.betterAuth.adapter.findMany,
        {
          model: "account",
          where: [{ field: "userId", value: userId }],
        },
      );

      const providers = (accounts || []).map((acc: any) => acc.providerId);
      return {
        userId,
        email: identity.email || user.email,
        name: user.name,
        providers,
        hasPassword: providers.includes("credential"),
      };
    } catch (e) {
      console.error("Error getting user auth status:", e);
      return null;
    }
  },
});

