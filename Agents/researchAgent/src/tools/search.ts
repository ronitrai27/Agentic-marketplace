import { getJson } from "serpapi";
import { ENV } from "../config/env.js";
import { FirecrawlAppV1 } from "@mendable/firecrawl-js";

export interface SearchResultItem {
  title: string;
  url: string;
  snippet?: string;
}

/**
 * Searches the web using SerpAPI (if key is set) with automatic fallback to Firecrawl Search
 */
export async function searchWeb(query: string, maxResults: number = 3): Promise<SearchResultItem[]> {
  console.log(`[Search] Query: "${query}"`);

  // Option 1: SerpAPI (Google Search)
  if (ENV.SERPAPI_KEY) {
    try {
      const res = await new Promise<any>((resolve, reject) => {
        getJson(
          {
            engine: "google",
            q: query,
            api_key: ENV.SERPAPI_KEY,
            num: maxResults,
          },
          (json: any) => {
            if (json.error) reject(new Error(json.error));
            else resolve(json);
          }
        );
      });

      const organic = res.organic_results || [];
      const results: SearchResultItem[] = organic.slice(0, maxResults).map((item: any) => ({
        title: item.title || "Untitled",
        url: item.link,
        snippet: item.snippet || "",
      }));

      if (results.length > 0) {
        return results;
      }
    } catch (err: any) {
      console.warn(`[Search] SerpAPI error: ${err.message}. Trying Firecrawl search fallback...`);
    }
  }

  // Option 2: Firecrawl Search fallback
  if (ENV.FIRECRAWL_API_KEY) {
    try {
      const firecrawl = new FirecrawlAppV1({ apiKey: ENV.FIRECRAWL_API_KEY });
      // Firecrawl v1 search API
      const searchRes: any = await (firecrawl as any).search(query, {
        limit: maxResults,
      });

      if (searchRes?.data && Array.isArray(searchRes.data)) {
        return searchRes.data.slice(0, maxResults).map((item: any) => ({
          title: item.title || item.metadata?.title || "Untitled Source",
          url: item.url || item.metadata?.sourceURL,
          snippet: item.description || item.markdown?.slice(0, 150) || "",
        }));
      }
    } catch (err: any) {
      console.warn(`[Search] Firecrawl search fallback error: ${err.message}`);
    }
  }

  console.warn(`[Search] No search provider returned results for query: "${query}"`);
  return [];
}
