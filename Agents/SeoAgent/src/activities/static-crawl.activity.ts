import { request } from "undici";
import * as cheerio from "cheerio";
import { createHash } from "node:crypto";
import { brotliDecompressSync, gunzipSync, inflateSync } from "node:zlib";

function decompressPayload(buffer: Buffer, encoding?: string): string {
  if (!encoding) return buffer.toString("utf8");

  const normalized = encoding.toLowerCase().trim();
  try {
    if (normalized.includes("br")) {
      return brotliDecompressSync(buffer).toString("utf8");
    }
    if (normalized.includes("gzip")) {
      return gunzipSync(buffer).toString("utf8");
    }
    if (normalized.includes("deflate")) {
      return inflateSync(buffer).toString("utf8");
    }
  } catch (err) {
    // If decompression fails (e.g. malformed or actually uncompressed), fallback to raw utf8
    return buffer.toString("utf8");
  }

  return buffer.toString("utf8");
}

export interface StaticCrawlInput {
  url: string;
  timeoutMs?: number;
  maxRedirects?: number;
}

export interface StructuredDataEntry {
  type?: string;
  rawJson: string;
  parsed?: Record<string, unknown> | unknown[];
  error?: string;
}

export interface StaticCrawlResult {
  url: string;
  finalUrl: string;
  statusCode: number;
  redirectChain: string[];
  timing: {
    fetchDurationMs: number;
    parseDurationMs: number;
    totalDurationMs: number;
  };
  headers: {
    contentType?: string;
    xRobotsTag?: string;
    canonicalHeader?: string;
    contentEncoding?: string;
    server?: string;
    rawHeaders: Record<string, string>;
  };
  contentHash: string;
  htmlSizeBytes: number;
  metadata: {
    title?: string;
    metaDescription?: string;
    declaredCanonical?: string;
    metaRobots?: string;
    openGraph: {
      title?: string;
      description?: string;
      image?: string;
      url?: string;
      type?: string;
    };
    h1Tags: string[];
    structuredData: StructuredDataEntry[];
  };
  spaIndicators: {
    hasRootContainer: boolean;
    rootContainerId?: string;
    scriptCount: number;
    bodyTextLength: number;
    isPotentialClientOnlySpa: boolean;
  };
}

/**
 * Pillar 1: Fast Static Ingestion Activity
 * High-performance HTTP/2 streaming client using undici and cheerio.
 * Captures status, redirect chains, headers, and metadata in sub-100ms.
 */
export async function staticCrawlActivity(input: StaticCrawlInput): Promise<StaticCrawlResult> {
  const startTime = performance.now();
  const timeoutMs = input.timeoutMs ?? 10000;
  const maxRedirects = input.maxRedirects ?? 5;

  let currentUrl = input.url;
  const redirectChain: string[] = [currentUrl];
  let redirectCount = 0;
  let finalResponse: any = null;
  let responseBody = "";

  // 1. Fetch pass with redirect traversal
  while (redirectCount <= maxRedirects) {
    const fetchStart = performance.now();
    const res = await request(currentUrl, {
      method: "GET",
      headersTimeout: timeoutMs,
      bodyTimeout: timeoutMs,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; EnterpriseSeoBot/1.0; +https://example.com/bot)",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Encoding": "gzip, deflate, br",
      },
    });

    const isRedirect = [301, 302, 307, 308].includes(res.statusCode);
    const locationHeader = res.headers["location"];

    if (isRedirect && locationHeader && typeof locationHeader === "string") {
      redirectCount++;
      const nextUrl = new URL(locationHeader, currentUrl).href;
      redirectChain.push(nextUrl);
      currentUrl = nextUrl;
      // Drain response body before following redirect
      await res.body.dump();
      continue;
    }

    finalResponse = res;
    const rawBuffer = Buffer.from(await res.body.arrayBuffer());
    const encodingHeader = res.headers["content-encoding"];
    const contentEncoding = typeof encodingHeader === "string" ? encodingHeader : undefined;
    responseBody = decompressPayload(rawBuffer, contentEncoding);
    break;
  }

  const fetchEndTime = performance.now();
  const fetchDurationMs = Math.round(fetchEndTime - startTime);

  if (!finalResponse) {
    throw new Error(`Failed to crawl URL: ${input.url} (Too many redirects or connection drop)`);
  }

  // 2. Cryptographic Content Hashing (SHA-256) for Immutable Proof Engine
  const contentHash = createHash("sha256").update(responseBody, "utf8").digest("hex");

  // 3. Header Extraction
  const rawHeaders: Record<string, string> = {};
  for (const [key, value] of Object.entries(finalResponse.headers)) {
    if (value !== undefined) {
      rawHeaders[key.toLowerCase()] = Array.isArray(value) ? value.join(", ") : String(value);
    }
  }

  const contentType = rawHeaders["content-type"];
  const xRobotsTag = rawHeaders["x-robots-tag"];
  const contentEncoding = rawHeaders["content-encoding"];
  const server = rawHeaders["server"];

  // Check link header canonical (RFC 5988 / 6596)
  let canonicalHeader: string | undefined;
  const linkHeader = rawHeaders["link"];
  if (linkHeader) {
    const match = linkHeader.match(/<([^>]+)>;\s*rel=["']?canonical["']?/i);
    if (match && match[1]) {
      canonicalHeader = match[1];
    }
  }

  // 4. Fast Cheerio Parse
  const parseStart = performance.now();
  const $ = cheerio.load(responseBody);

  const title = $("title").first().text().trim() || undefined;
  const metaDescription = $('meta[name="description" i]').attr("content")?.trim() || undefined;
  const declaredCanonical = $('link[rel="canonical" i]').attr("href")?.trim() || undefined;
  const metaRobots = $('meta[name="robots" i]').attr("content")?.trim() || undefined;

  const openGraph = {
    title: $('meta[property="og:title" i]').attr("content")?.trim() || undefined,
    description: $('meta[property="og:description" i]').attr("content")?.trim() || undefined,
    image: $('meta[property="og:image" i]').attr("content")?.trim() || undefined,
    url: $('meta[property="og:url" i]').attr("content")?.trim() || undefined,
    type: $('meta[property="og:type" i]').attr("content")?.trim() || undefined,
  };

  const h1Tags: string[] = [];
  $("h1").each((_, el) => {
    const text = $(el).text().trim();
    if (text) h1Tags.push(text);
  });

  // Extract structured data JSON-LD scripts
  const structuredData: StructuredDataEntry[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    const rawJson = $(el).html()?.trim() || "";
    if (rawJson) {
      try {
        const parsed = JSON.parse(rawJson);
        const type = parsed["@type"] ?? (Array.isArray(parsed) ? "Array" : undefined);
        structuredData.push({ type, rawJson, parsed });
      } catch (err: any) {
        structuredData.push({ rawJson, error: err?.message || "Invalid JSON-LD syntax" });
      }
    }
  });

  // 5. Detect Client-Side SPA / Hydration Signatures for JEV Router Gate
  let rootContainerId: string | undefined;
  let hasRootContainer = false;

  for (const candidate of ["#root", "#__next", "#app", "#main-content"]) {
    if ($(candidate).length > 0) {
      hasRootContainer = true;
      rootContainerId = candidate;
      break;
    }
  }

  const scriptCount = $("script").length;
  const bodyText = $("body").text().replace(/\s+/g, " ").trim();
  const bodyTextLength = bodyText.length;

  // SPA heuristic: Has root container, very little text, but multiple script tags
  const isPotentialClientOnlySpa = hasRootContainer && bodyTextLength < 300 && scriptCount > 2;

  const parseEndTime = performance.now();
  const parseDurationMs = Math.round(parseEndTime - parseStart);
  const totalDurationMs = Math.round(parseEndTime - startTime);

  return {
    url: input.url,
    finalUrl: currentUrl,
    statusCode: finalResponse.statusCode,
    redirectChain,
    timing: {
      fetchDurationMs,
      parseDurationMs,
      totalDurationMs,
    },
    headers: {
      contentType,
      xRobotsTag,
      canonicalHeader,
      contentEncoding,
      server,
      rawHeaders,
    },
    contentHash,
    htmlSizeBytes: Buffer.byteLength(responseBody, "utf8"),
    metadata: {
      title,
      metaDescription,
      declaredCanonical,
      metaRobots,
      openGraph,
      h1Tags,
      structuredData,
    },
    spaIndicators: {
      hasRootContainer,
      rootContainerId,
      scriptCount,
      bodyTextLength,
      isPotentialClientOnlySpa,
    },
  };
}
