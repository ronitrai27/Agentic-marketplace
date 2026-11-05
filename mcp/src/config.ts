export const config = {
  port: Number(process.env.PORT ?? 8787),
  publicUrl: process.env.MCP_PUBLIC_URL ?? "http://localhost:8787/mcp",
  authIssuer: process.env.AUTH_ISSUER,
  convexSiteUrl: process.env.CONVEX_SITE_URL,
  backendSecret: process.env.MCP_BACKEND_SECRET,
};

export const SCOPES = ["wallet:read"] as const;
