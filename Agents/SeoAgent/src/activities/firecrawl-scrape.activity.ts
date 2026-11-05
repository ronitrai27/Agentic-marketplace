import { env } from "../config/env.js";

export interface FirecrawlScrapeInput {
  url: string;
}

export interface FirecrawlScrapeResult {
  success: boolean;
  markdown?: string;
  title?: string;
  description?: string;
  statusCode?: number;
  error?: string;
  durationMs: number;
}

/**
 * Parallel Scraping Activity via Firecrawl v2 API.
 * Extracts clean main-content markdown and page metadata in the background.
 */
export async function firecrawlScrapeActivity(
  input: FirecrawlScrapeInput
): Promise<FirecrawlScrapeResult> {
  const startTime = performance.now();
  const apiKey = env.FIRECRAWL_API_KEY;

  if (!apiKey) {
    return {
      success: false,
      error: "Missing FIRECRAWL_API_KEY in environment",
      durationMs: 0,
    };
  }

  console.log(`🔥 [Temporal Activity: Firecrawl] Scraping deep markdown for: ${input.url}...`);
  try {
    const response = await fetch("https://api.firecrawl.dev/v2/scrape", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        url: input.url,
        onlyMainContent: true,
        maxAge: 172800000,
        parsers: ["pdf"],
        formats: ["markdown"],
      }),
    });

    const durationMs = Math.round(performance.now() - startTime);

    if (!response.ok) {
      const errText = await response.text();
      console.log(`⚠️ [Temporal Activity: Firecrawl] Scrape returned HTTP ${response.status}`);
      return {
        success: false,
        statusCode: response.status,
        error: `Firecrawl API returned HTTP ${response.status}: ${errText.slice(0, 200)}`,
        durationMs,
      };
    }

    const data = (await response.json()) as any;
    const markdown = data?.data?.markdown || data?.markdown || "";
    const metadata = data?.data?.metadata || data?.metadata || {};

    const preview = markdown.replace(/\s+/g, " ").slice(0, 150);
    console.log(
      `🔥 [Temporal Activity: Firecrawl] ✅ Scraped ${markdown.length} chars in ${durationMs}ms | Title: "${metadata.title || "N/A"}"`
    );
    console.log(`   Preview: "${preview}..."`);

    return {
      success: true,
      markdown,
      title: metadata.title,
      description: metadata.description,
      statusCode: metadata.statusCode || 200,
      durationMs,
    };
  } catch (err: any) {
    return {
      success: false,
      error: err.message || String(err),
      durationMs: Math.round(performance.now() - startTime),
    };
  }
}
