import { httpRouter, HttpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { authComponent, createAuth } from "./betterAuth/auth";

const http = httpRouter();

// ── BetterAuth Routes ────────────────────────────────────────────────────────
authComponent.registerRoutes(http, createAuth);

// ── Fix 3: Gateway API Key Verification Endpoint ─────────────────────────────
//
// This is the ONLY public surface for verifyApiKey.
// The underlying `internal.apiKeys.verifyApiKey` is an internalMutation —
// it can NEVER be called from the browser. This HTTP action is the gatekeeper.
//
// Expected request from the Catelog Gateway:
//   POST /api/verify-key
//   Authorization: Bearer <CATELOG_GATEWAY_SECRET>
//   Content-Type: application/json
//   { "keyHash": "<sha256-hex>", "clientIp": "1.2.3.4", "region": "us-east-1" }
//
// The gateway signs the request with a shared secret (CATELOG_GATEWAY_SECRET)
// stored only in Convex environment variables — never exposed to clients.

const GATEWAY_SECRET = process.env.CATELOG_GATEWAY_SECRET;

http.route({
  path: "/api/verify-key",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    // ── Verify this is a legitimate gateway request ──
    const authHeader = request.headers.get("Authorization") ?? "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

    if (GATEWAY_SECRET && token !== GATEWAY_SECRET) {
      return new Response(
        JSON.stringify({ valid: false, error: "GATEWAY_UNAUTHORIZED" }),
        { status: 401, headers: { "Content-Type": "application/json" } }
      );
    }

    // ── Parse body ──
    let body: { keyHash?: string; clientIp?: string; region?: string };
    try {
      body = await request.json();
    } catch {
      return new Response(
        JSON.stringify({ valid: false, error: "INVALID_BODY" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    if (!body.keyHash || typeof body.keyHash !== "string") {
      return new Response(
        JSON.stringify({ valid: false, error: "MISSING_KEY_HASH" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // ── Delegate to internalMutation (Fix 3) ──
    const result = await ctx.runMutation(internal.apiKeys.verifyApiKey, {
      keyHash: body.keyHash,
      clientIp: body.clientIp,
      region: body.region,
    });

    const status = result.valid ? 200 : 403;
    return new Response(JSON.stringify(result), {
      status,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
    });
  }),
});

export default http;
