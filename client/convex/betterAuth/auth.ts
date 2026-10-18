import { createClient, type GenericCtx } from "@convex-dev/better-auth";
import { convex } from "@convex-dev/better-auth/plugins";
import type { BetterAuthOptions } from "better-auth";
import { betterAuth } from "better-auth";
import { components } from "../_generated/api";
import type { DataModel } from "../_generated/dataModel";
import authConfig from "../auth.config";
import schema from "./schema";

// Better Auth Component
export const authComponent = createClient<DataModel, typeof schema>(
  (components as any).betterAuth,
  {
    local: { schema },
    verbose: false,
  },
);

// Better Auth Options
export const createAuthOptions = (ctx: GenericCtx<DataModel>) => {
  const providers: BetterAuthOptions["socialProviders"] = {};

  if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
    providers.google = {
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    };
  }

  if (process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET) {
    providers.github = {
      clientId: process.env.GITHUB_CLIENT_ID,
      clientSecret: process.env.GITHUB_CLIENT_SECRET,
    };
  }

  const baseURL =
    process.env.SITE_URL ||
    process.env.BETTER_AUTH_URL ||
    "http://localhost:3000";

  const trustedOrigins = Array.from(
    new Set([baseURL, "http://localhost:3000"].filter(Boolean)),
  );

  return {
    appName: "Marketplace",
    baseURL: baseURL,
    trustedOrigins: trustedOrigins,
    secret: process.env.BETTER_AUTH_SECRET,
    database: authComponent.adapter(ctx),
    user: {
      additionalFields: {
        onboardingCompleted: {
          type: "boolean",
          required: false,
          defaultValue: false,
          input: true,
          returned: true,
        },
        credits: {
          type: "number",
          required: false,
          defaultValue: 0,
          input: true,
          returned: true,
        },
      },
    },
    emailAndPassword: {
      enabled: true,
    },
    socialProviders: providers,
    account: {
      accountLinking: {
        enabled: true,
      },
    },
    plugins: [convex({ authConfig }) as any],
  } satisfies BetterAuthOptions;
};

// For `auth` CLI
export const options = createAuthOptions({} as GenericCtx<DataModel>);

// Better Auth Instance
export const createAuth = (ctx: GenericCtx<DataModel>) => {
  return betterAuth(createAuthOptions(ctx));
};
