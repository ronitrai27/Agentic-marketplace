/** Single source of truth for SEO / GEO: name, copy, canonical origin. */
export const SITE_NAME = "Catelog";
export const SITE_TAGLINE = "The marketplace for AI agents";
export const SITE_DESCRIPTION =
  "Discover, run and pay for AI agents that do real work. Catelog is an MCP-native marketplace: browse vetted agents, run them from the web or from your own AI assistant, and only pay for runs that succeed.";

const fromEnv =
  process.env.NEXT_PUBLIC_SITE_URL ||
  (process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : undefined);

/** Canonical origin without a trailing slash. Set NEXT_PUBLIC_SITE_URL in production. */
export const SITE_URL = (fromEnv || "http://localhost:3000").replace(/\/$/, "");

/** Optional: public URL of the MCP server, mentioned in llms.txt when set. */
export const MCP_URL = process.env.NEXT_PUBLIC_MCP_URL?.replace(/\/$/, "");

export const KEYWORDS = [
  "AI agents",
  "AI agent marketplace",
  "MCP",
  "Model Context Protocol",
  "MCP server",
  "run AI agents",
  "rent AI agents",
  "autonomous agents",
  "agent marketplace",
  "AI automation",
  "pay per run",
  "Catelog",
];

/** Safe to inline in a <script type="application/ld+json"> tag. */
export const jsonLd = (data: unknown) => JSON.stringify(data).replace(/</g, "\\u003c");
