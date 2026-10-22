import type { SeoAgentStateType } from "../state.js";
import { firecrawlScrapeActivity } from "../../activities/firecrawl-scrape.activity.js";

/**
 * Parallel Scraping Sub-Agent Node (Firecrawl v2).
 * Runs concurrently with the SEO audit pipeline to extract clean markdown,
 * allowing the user to ask in-depth questions about specific page content anytime.
 */
export async function firecrawlNode(state: SeoAgentStateType): Promise<Partial<SeoAgentStateType>> {
  const url = state.currentUrl;
  if (!url) {
    return {};
  }

  console.log(`🔥 [Firecrawl] Starting parallel scrape for deep page content: ${url}`);
  try {
    const scrapedContent = await firecrawlScrapeActivity({ url });
    if (scrapedContent.success) {
      const preview = (scrapedContent.markdown || "").replace(/\s+/g, " ").slice(0, 180);
      console.log(
        `🔥 [Firecrawl] ✅ Scraped successfully (${scrapedContent.durationMs}ms):`
      );
      console.log(`   • Title: "${scrapedContent.title || "N/A"}"`);
      console.log(`   • Description: "${scrapedContent.description || "N/A"}"`);
      console.log(`   • Markdown Size: ${scrapedContent.markdown?.length ?? 0} characters`);
      console.log(`   • Content Preview: "${preview}..."`);
    } else {
      console.log(`⚠️ [Firecrawl] Scrape notice: ${scrapedContent.error || "Unknown error"}`);
    }
    return { scrapedContent };
  } catch (err: any) {
    console.log(`⚠️ [Firecrawl] Scrape failed: ${err.message || String(err)}`);
    return {
      scrapedContent: {
        success: false,
        error: err.message || String(err),
        durationMs: 0,
      },
    };
  }
}
