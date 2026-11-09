"use node";

import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { ConvexError, v } from "convex/values";
import { assertPublicUrl } from "../src/lib/ssrf";

const TIMEOUT_MS = 60_000;

export type WebhookTest =
  | { ok: true; latencyMs: number; output: unknown }
  | { ok: false; message: string };

/**
 * Creator tests their n8n webhook before registering. The marketplace calls it the same way it will for buyers:
 * POST the input as JSON with the creator's X-Marketplace-Key header. The browser never sees the key sent.
 */
export const testWebhook = action({
  args: { url: v.string(), inputJson: v.string() },
  handler: async (ctx, { url, inputJson }): Promise<WebhookTest> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Please sign in." });

    const row = await ctx.runQuery(internal.apiKeys._getAuthKeyRow, { userId: identity.subject });
    if (!row) return { ok: false, message: "Create your X-Marketplace-Key in API Keys first." };
    if (row.expiresAt && row.expiresAt <= Date.now()) {
      return { ok: false, message: "Your X-Marketplace-Key has expired. Rotate it in API Keys." };
    }

    let target: URL;
    try {
      target = new URL(url.trim());
      await assertPublicUrl(target.toString());
    } catch {
      return { ok: false, message: "This URL is not reachable. Use your n8n Production URL." };
    }
    if (target.pathname.includes("/webhook-test/")) {
      return { ok: false, message: "That is the n8n Test URL. Publish the workflow and use the Production URL." };
    }

    let body: string;
    try {
      body = JSON.stringify(JSON.parse(inputJson));
    } catch {
      return { ok: false, message: "The sample input is not valid JSON." };
    }

    const started = Date.now();
    try {
      const res = await fetch(target, {
        method: "POST",
        redirect: "manual",
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { "Content-Type": "application/json", "X-Marketplace-Key": row.rawKey },
        body,
      });
      const latencyMs = Date.now() - started;
      const text = await res.text();
      if (res.status === 403 || res.status === 401) {
        return {
          ok: false,
          message:
            "n8n rejected the key. Paste your X-Marketplace-Key into the n8n Header Auth credential (header name X-Marketplace-Key).",
        };
      }
      if (res.status === 404) {
        return { ok: false, message: "n8n says this webhook doesn't exist. Is the workflow published?" };
      }
      if (!res.ok) return { ok: false, message: `n8n answered with an error (${res.status}).` };
      let output: unknown;
      try {
        output = JSON.parse(text);
      } catch {
        return { ok: false, message: "The workflow must answer with JSON (use a Respond to Webhook node)." };
      }
      return { ok: true, latencyMs, output };
    } catch {
      return { ok: false, message: "No answer from n8n within 60 seconds." };
    }
  },
});
