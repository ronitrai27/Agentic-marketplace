import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

// Public pages: landing, marketplace and agent pages. Everything account-related stays out of indexes.
const PUBLIC = ["/", "/space/marketplace", "/llms.txt"];
const PRIVATE = ["/api/", "/oauth/", "/auth/", "/welcome", "/space/"];

// AI search / answer-engine crawlers are welcome: being cited by them is part of GEO.
const AI_BOTS = [
  "GPTBot",
  "OAI-SearchBot",
  "ChatGPT-User",
  "ClaudeBot",
  "Claude-SearchBot",
  "Claude-User",
  "anthropic-ai",
  "PerplexityBot",
  "Perplexity-User",
  "Google-Extended",
  "Applebot-Extended",
  "Bingbot",
  "CCBot",
  "Amazonbot",
  "meta-externalagent",
  "DuckAssistBot",
  "MistralAI-User",
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: "*", allow: PUBLIC, disallow: PRIVATE },
      { userAgent: AI_BOTS, allow: PUBLIC, disallow: PRIVATE },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
