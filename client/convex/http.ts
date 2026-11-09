import { httpRouter, HttpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
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

// ── MCP server: agent discovery + schemas ───────────────────────────────────
//   POST /mcp/discover-agents  { query?, tag?, limit? }
//   POST /mcp/agent-schemas    { slugs: string[] }
// Same Bearer <MCP_BACKEND_SECRET> guard as the wallet route. Public marketplace data only.
const mcpRoute = (path: string, handle: (ctx: any, body: any) => Promise<unknown>) =>
  http.route({
    path,
    method: "POST",
    handler: httpAction(async (ctx, request) => {
      const secret = process.env.MCP_BACKEND_SECRET;
      const token = (request.headers.get("Authorization") ?? "").replace(/^Bearer /, "");
      if (!secret || !safeEqual(token, secret)) return json({ error: "unauthorized" }, 401);
      let body: any;
      try {
        body = await request.json();
      } catch {
        return json({ error: "invalid_body" }, 400);
      }
      try {
        return json(await handle(ctx, body ?? {}));
      } catch (err) {
        console.error(path, err);
        return json({ error: "server_error" }, 500);
      }
    }),
  });

mcpRoute("/mcp/discover-agents", async (ctx, b) =>
  ctx.runQuery(internal.mcpAgents.discover, {
    query: typeof b.query === "string" ? b.query.slice(0, 200) : undefined,
    tag: typeof b.tag === "string" ? b.tag.slice(0, 50) : undefined,
    limit: typeof b.limit === "number" ? b.limit : undefined,
  }),
);

mcpRoute("/mcp/agent-schemas", async (ctx, b) =>
  ctx.runQuery(internal.mcpAgents.schemasBySlugs, {
    slugs: Array.isArray(b.slugs) ? b.slugs.filter((s: unknown) => typeof s === "string").slice(0, 10) : [],
  }),
);

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

// ── Marketplace gateway: start a run ────────────────────────────────────────
//   POST /v1/runs
//   Authorization: Bearer cat_sec_live_...   (SDK / server-side callers)
//              or  Bearer <session JWT>      (signed-in humans, no key needed)
//   X-Catelog-Region: us-east-1              (only needed for region-restricted keys)
//   { "agent": "<slug>", "input": { ... } }
//
// Accepts the run and starts a Temporal workflow, then returns { runId } immediately.
// The agent's baseUrl is never read here or returned: only the worker resolves it.

const MAX_BODY_BYTES = 256_000;
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,99}$/;

const gatewayError = (
  status: number,
  code: string,
  message: string,
  requestId: string,
  retryAfterSec?: number,
) =>
  new Response(JSON.stringify({ error: { code, message, requestId } }), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      ...(retryAfterSec ? { "Retry-After": String(retryAfterSec) } : {}),
    },
  });

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Compares in time independent of where the strings differ. */
function safeEqual(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

const KEY_ERROR_STATUS: Record<string, number> = {
  INVALID_KEY: 401,
  KEY_REVOKED: 401,
  KEY_EXPIRED: 401,
  REGION_RESTRICTED: 403,
  IP_FORBIDDEN: 403,
  RATE_LIMITED: 429,
};

http.route({
  path: "/v1/runs",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const requestId = crypto.randomUUID();

    // 1. Size cap before reading anything
    const declared = Number(request.headers.get("Content-Length") ?? "0");
    if (declared > MAX_BODY_BYTES) {
      return gatewayError(413, "PAYLOAD_TOO_LARGE", "Request body is too large", requestId);
    }
    const text = await request.text();
    if (text.length > MAX_BODY_BYTES) {
      return gatewayError(413, "PAYLOAD_TOO_LARGE", "Request body is too large", requestId);
    }

    let body: { agent?: unknown; input?: unknown };
    try {
      body = JSON.parse(text);
    } catch {
      return gatewayError(400, "INVALID_BODY", "Body must be JSON", requestId);
    }
    const { agent, input } = body ?? {};
    if (typeof agent !== "string" || !SLUG_RE.test(agent)) {
      return gatewayError(400, "INVALID_AGENT", "`agent` must be an agent slug", requestId);
    }
    if (input === null || typeof input !== "object" || Array.isArray(input)) {
      return gatewayError(400, "INVALID_INPUT", "`input` must be a JSON object", requestId);
    }

    // 2. Who is calling: secret key (IP, region, req/min enforced) or signed-in session
    const bearer = (request.headers.get("Authorization") ?? "").replace(/^Bearer /, "").trim();
    let userId: string;
    let keyId: Id<"creator_api_keys"> | undefined;

    // Last hop is the one the platform proxy added; earlier entries are client-supplied.
    const forwarded = (request.headers.get("X-Forwarded-For") ?? "").split(",");
    const clientIp = forwarded[forwarded.length - 1]?.trim() || undefined;
    const clientRegion =
      request.headers.get("X-Catelog-Region")?.trim() ||
      request.headers.get("CF-IPCountry")?.trim() ||
      request.headers.get("X-Vercel-IP-Country")?.trim() ||
      undefined;

    if (bearer.startsWith("cat_sec_")) {
      const verdict = await ctx.runMutation(internal.apiKeys.verifyApiKey, {
        keyHash: await sha256Hex(bearer),
        clientIp,
        region: request.headers.get("X-Catelog-Region")?.trim() || undefined,
      });
      if (!verdict.valid) {
        const code = verdict.error ?? "INVALID_KEY";
        const retryAfterSec =
          "retryAfterMs" in verdict && verdict.retryAfterMs
            ? Math.ceil(verdict.retryAfterMs / 1000)
            : undefined;
        return gatewayError(
          KEY_ERROR_STATUS[code] ?? 401,
          code,
          verdict.message ?? "Key rejected",
          requestId,
          retryAfterSec,
        );
      }
      userId = verdict.userId!;
      keyId = verdict.keyId;
    } else {
      const identity = bearer ? await ctx.auth.getUserIdentity() : null;
      if (!identity) return gatewayError(401, "UNAUTHENTICATED", "Sign in or send a secret key", requestId);
      userId = identity.subject;
    }

    // 3. Admission: agent exists, its own SDK limits (req/min, max concurrent), then the run row
    const admitted = await ctx.runMutation(internal.runs.admit, {
      slug: agent,
      userId,
      source: keyId ? "key" : "session",
      keyId,
      inputJson: JSON.stringify(input),
      clientIp,
      clientRegion,
    });
    if (!admitted.ok) {
      return gatewayError(admitted.status, admitted.code, admitted.message, requestId, admitted.retryAfterSec);
    }
    const runId = admitted.runId as Id<"runs">;

    // 4. Hand off to Temporal. If that fails, close the run so it frees its slot.
    try {
      await ctx.runAction(internal.temporal.startRunWorkflow, {
        runId,
        timeoutSeconds: admitted.timeoutSeconds,
      });
    } catch (err) {
      console.error("startRunWorkflow failed", requestId, err);
      await ctx.runMutation(internal.runs.setStatus, {
        runId,
        status: "failed",
        error: { code: "WORKFLOW_START_FAILED", message: "Could not start the run" },
      });
      return gatewayError(503, "WORKFLOW_START_FAILED", "Could not start the run, try again", requestId, 5);
    }

    return new Response(JSON.stringify({ runId, status: "queued" }), {
      status: 202,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  }),
});

// ── Temporal worker routes ───────────────────────────────────────────────────
// All guarded by `Authorization: Bearer <WORKER_SECRET>`. Only the worker calls these.
//   POST /worker/run-context   { runId }                           → agent URL, schemas, sealed creator keys
//   POST /worker/run-status    { runId, status, error? }           → running | failed | cancelled
//   POST /worker/run-events    { runId, events: [{type, data}] }   → live feed for the run sheet
//   POST /worker/agent-key     { runId, keyId }                    → which creator key the agent accepted
//   POST /worker/run-complete  { runId, output }                   → output passed its schema: charge and close

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

const workerAuthorised = (request: Request) => {
  const secret = process.env.WORKER_SECRET;
  const token = (request.headers.get("Authorization") ?? "").replace(/^Bearer /, "");
  return !!secret && safeEqual(token, secret);
};

const workerRoute = (path: string, handle: (ctx: any, body: any) => Promise<Response>) =>
  http.route({
    path,
    method: "POST",
    handler: httpAction(async (ctx, request) => {
      if (!workerAuthorised(request)) return json({ error: "unauthorized" }, 401);
      let body: any;
      try {
        body = await request.json();
      } catch {
        return json({ error: "invalid_body" }, 400);
      }
      try {
        return await handle(ctx, body);
      } catch (err) {
        console.error(path, err);
        return json({ error: "invalid_body" }, 400);
      }
    }),
  });

workerRoute("/worker/run-context", async (ctx, { runId }) => {
  const context = await ctx.runQuery(internal.runs.contextForWorker, { runId });
  return context ? json(context) : json({ error: "not_found" }, 404);
});

workerRoute("/worker/run-status", async (ctx, { runId, status, error }) => {
  const result = await ctx.runMutation(internal.runs.setStatus, { runId, status, error });
  return json(result, result.ok ? 200 : result.reason === "not_found" ? 404 : 409);
});

workerRoute("/worker/run-events", async (ctx, { runId, events }) => {
  const rows = (Array.isArray(events) ? events : []).slice(0, 200).map((e: { type: string; data: unknown }) => ({
    type: String(e.type).slice(0, 64),
    dataJson: JSON.stringify(e.data ?? null),
  }));
  const result = await ctx.runMutation(internal.runs.appendEvents, { runId, events: rows });
  return json(result);
});

workerRoute("/worker/agent-key", async (ctx, { runId, keyId }) => {
  return json(await ctx.runMutation(internal.runs.rememberSigningKey, { runId, keyId }));
});

workerRoute("/worker/run-complete", async (ctx, { runId, output }) => {
  const result = await ctx.runMutation(internal.runs.complete, { runId, outputJson: JSON.stringify(output ?? null) });
  return json(result, result.ok ? 200 : result.reason === "not_found" ? 404 : 409);
});

export default http;
