import { FirecrawlAppV1 } from "@mendable/firecrawl-js";
import { ENV } from "../config/env.js";
import { notifyProgress } from "../observability/progress.js";

export interface ScrapedPage {
  url: string;
  title?: string;
  markdown: string;
  success: boolean;
}

const firecrawl = new FirecrawlAppV1({ apiKey: ENV.FIRECRAWL_API_KEY });

/**
 * Scrapes a single web URL into clean markdown with strict token guardrails
 */
export async function scrapePage(url: string, fallbackTitle?: string): Promise<ScrapedPage> {
  if (!url || !url.startsWith("http")) {
    return { url, markdown: "", success: false };
  }

  const domain = new URL(url).hostname.replace("www.", "");
  console.log(`[Firecrawl] Scraping URL: ${url}`);
  notifyProgress(`📄 [Firecrawl] Reading authoritative source: ${domain}`);

  try {
    const res: any = await firecrawl.scrapeUrl(url, {
      formats: ["markdown"],
    });

    const markdown: string = res.markdown || res.data?.markdown || "";
    // Truncate to safe character limit to avoid blowing up the context window
    const cleanedContent = markdown.slice(0, ENV.MAX_SCRAPE_CHARS);

    return {
      url,
      title: fallbackTitle || url,
      markdown: cleanedContent,
      success: cleanedContent.length > 50,
    };
  } catch (err: any) {
    console.warn(`[Firecrawl] Failed to scrape ${url}: ${err.message}`);
    return {
      url,
      title: fallbackTitle || url,
      markdown: "",
      success: false,
    };
  }
}
