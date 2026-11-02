import { Hono } from "hono";
import { createMcpHandler, requireBearerAuth, getOAuthProtectedResourceMetadataUrl } from "@modelcontextprotocol/server";
import { createServer } from "./server.js";
import { createVerifier } from "./auth.js";
import { config, SCOPES } from "./config.js";

const resource = new URL(config.publicUrl);
const metadataUrl = getOAuthProtectedResourceMetadataUrl(resource);
const handler = createMcpHandler(createServer);
const gate = requireBearerAuth({
  verifier: createVerifier(),
  requiredScopes: ["wallet:read"],
  resourceMetadataUrl: metadataUrl,
});

export const app = new Hono();

app.get("/health", (c) => c.json({ ok: true }));

// RFC 9728: tells MCP clients which authorization server to send the user to.
app.get(new URL(metadataUrl).pathname, (c) =>
  c.json({
    resource: resource.href,
    authorization_servers: config.authIssuer ? [config.authIssuer] : [],
    scopes_supported: SCOPES,
    bearer_methods_supported: ["header"],
  }),
);

app.all(resource.pathname, async (c) => {
  const auth = await gate(c.req.raw);
  if (auth instanceof Response) return auth;
  return handler.fetch(c.req.raw, { authInfo: auth });
});
