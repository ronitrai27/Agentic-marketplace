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

// ── MCP server: wallet lookup ────────────────────────────────────────────────
// Called only by the Catelog MCP server after it verified the user's OAuth token.
//   POST /mcp/wallet   Authorization: Bearer <MCP_BACKEND_SECRET>   { "userId": "..." }
http.route({
  path: "/mcp/wallet",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const secret = process.env.MCP_BACKEND_SECRET;
    const token = (request.headers.get("Authorization") ?? "").replace(/^Bearer /, "");
    if (!secret || token !== secret) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }
    let userId: unknown;
    try {
      ({ userId } = await request.json());
    } catch {
      return new Response(JSON.stringify({ error: "invalid_body" }), { status: 400 });
    }
    if (typeof userId !== "string" || !userId) {
      return new Response(JSON.stringify({ error: "missing_user_id" }), { status: 400 });
    }
    const wallet = await ctx.runQuery(internal.wallet.getWalletByUserId, { userId });
    if (!wallet) {
      return new Response(JSON.stringify({ error: "user_not_found" }), { status: 404 });
    }
    return new Response(JSON.stringify(wallet), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }),
});

// ── MCP server: access-token introspection ──────────────────────────────────
// The MCP server forwards the user's OAuth access token here to learn who owns it.
//   POST /mcp/introspect   Authorization: Bearer <MCP_BACKEND_SECRET>   { "token": "..." }
http.route({
  path: "/mcp/introspect",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const secret = process.env.MCP_BACKEND_SECRET;
    const caller = (request.headers.get("Authorization") ?? "").replace(
      /^Bearer /,
      "",
    );
    if (!secret || caller !== secret) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
      });
    }
    let token: unknown;
    try {
      ({ token } = await request.json());
    } catch {
      return new Response(JSON.stringify({ error: "invalid_body" }), {
        status: 400,
      });
    }
    const inactive = new Response(JSON.stringify({ active: false }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
    if (typeof token !== "string" || !token) return inactive;

    const auth = createAuth(ctx);
    // Plugins are registered `as any` in auth.ts, so the typed api lacks getMcpSession.
    const session = await (auth.api as any).getMcpSession({
      headers: new Headers({ Authorization: `Bearer ${token}` }),
    });
    if (!session || !session.userId) return inactive;

    return new Response(
      JSON.stringify({
        active: true,
        userId: session.userId,
        clientId: session.clientId,
        scope: session.scopes,
        exp: Math.floor(new Date(session.accessTokenExpiresAt).getTime() / 1000),
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }),
});

export default http;
