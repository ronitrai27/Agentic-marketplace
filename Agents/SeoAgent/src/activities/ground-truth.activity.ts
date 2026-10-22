import { env } from "../config/env.js";

export interface PageSpeedResult {
  performanceScore?: number;
  coreWebVitals?: {
    lcpMs?: number;
    cls?: number;
    inpMs?: number;
  };
  error?: string;
}

export interface SerpRankResult {
  query: string;
  targetUrl: string;
  position?: number;
  foundInTop10: boolean;
  topCompetitors: string[];
  error?: string;
}

export interface GroundTruthResult {
  url: string;
  pageSpeed?: PageSpeedResult;
  serp?: SerpRankResult;
}

// In-memory rate-limiter: enforces minimum 1.5s between PageSpeed calls to prevent rate-limit abuse
let lastPageSpeedCall = 0;

/**
 * Pillar 3: Ground Truth Activity (PageSpeed / CrUX + SerpApi)
 * Uses strict throttling and bounds.
 */
export async function groundTruthActivity(input: {
  url: string;
  targetKeyword?: string;
}): Promise<GroundTruthResult> {
  const result: GroundTruthResult = { url: input.url };

  // 1. Google PageSpeed / CrUX API (Throttled)
  if (env.GOOGLE_PAGESPEED_KEY) {
    const now = Date.now();
    const waitTime = Math.max(0, 1500 - (now - lastPageSpeedCall));
    if (waitTime > 0) {
      await new Promise((resolve) => setTimeout(resolve, waitTime));
    }
    lastPageSpeedCall = Date.now();

    try {
      const endpoint = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(
        input.url
      )}&key=${env.GOOGLE_PAGESPEED_KEY}&strategy=mobile`;

      const res = await fetch(endpoint, { signal: AbortSignal.timeout(15000) });
      if (res.ok) {
        const data = (await res.json()) as any;
        const lighthouse = data.lighthouseResult;
        const score = lighthouse?.categories?.performance?.score;
        const audits = lighthouse?.audits || {};

        result.pageSpeed = {
          performanceScore: typeof score === "number" ? Math.round(score * 100) : undefined,
          coreWebVitals: {
            lcpMs: audits["largest-contentful-paint"]?.numericValue ? Math.round(audits["largest-contentful-paint"].numericValue) : undefined,
            cls: audits["cumulative-layout-shift"]?.numericValue !== undefined ? parseFloat(audits["cumulative-layout-shift"].numericValue.toFixed(3)) : undefined,
            inpMs: audits["interaction-to-next-paint"]?.numericValue ? Math.round(audits["interaction-to-next-paint"].numericValue) : undefined,
          },
        };
      } else {
        result.pageSpeed = { error: `PageSpeed API status ${res.status}` };
      }
    } catch (err: any) {
      result.pageSpeed = { error: err?.message || "PageSpeed request timeout" };
    }
  }

  // 2. SerpApi Google Organic Rank & Intent
  if (env.SERPAPI_KEY && input.targetKeyword) {
    try {
      const serpUrl = `https://serpapi.com/search.json?engine=google&q=${encodeURIComponent(
        input.targetKeyword
      )}&api_key=${env.SERPAPI_KEY}`;

      const res = await fetch(serpUrl, { signal: AbortSignal.timeout(10000) });
      if (res.ok) {
        const data = (await res.json()) as any;
        const organicResults: any[] = data.organic_results || [];

        const targetDomain = new URL(input.url).hostname.replace(/^www\./, "");
        let position: number | undefined;

        for (let i = 0; i < organicResults.length; i++) {
          const item = organicResults[i];
          if (item?.link && item.link.includes(targetDomain)) {
            position = i + 1;
            break;
          }
        }

        const topCompetitors = organicResults.slice(0, 3).map((r) => r.link).filter(Boolean);

        result.serp = {
          query: input.targetKeyword,
          targetUrl: input.url,
          position,
          foundInTop10: Boolean(position && position <= 10),
          topCompetitors,
        };
      }
    } catch (err: any) {
      result.serp = {
        query: input.targetKeyword,
        targetUrl: input.url,
        foundInTop10: false,
        topCompetitors: [],
        error: err?.message || "SerpApi request failed",
      };
    }
  }

  console.log(
    `📊 [Temporal Activity: Ground Truth] ✅ PageSpeed: ${result.pageSpeed?.performanceScore ?? "N/A"}/100 (LCP: ${result.pageSpeed?.coreWebVitals?.lcpMs ?? "N/A"}ms) | SERP Rank: #${result.serp?.position ?? "Unranked"}`
  );

  return result;
}
