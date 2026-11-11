export const config = {
  port: Number(process.env.PORT ?? 8787),
  publicUrl: process.env.MCP_PUBLIC_URL ?? "http://localhost:8787/mcp",
  authIssuer: process.env.AUTH_ISSUER,
  convexSiteUrl: process.env.CONVEX_SITE_URL,
  backendSecret: process.env.MCP_BACKEND_SECRET,
  /** Web app origin, used to build approval links. */
  webUrl: (process.env.WEB_URL ?? process.env.AUTH_ISSUER ?? "http://localhost:3000").replace(/\/$/, ""),
};

export const SCOPES = ["wallet:read", "runs:execute"] as const;
