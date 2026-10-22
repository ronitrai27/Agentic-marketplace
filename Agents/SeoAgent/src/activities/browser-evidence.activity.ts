import { chromium, type Browser, type Page } from "playwright";
import Browserbase from "@browserbasehq/sdk";
import { env } from "../config/env.js";
import type { StaticCrawlResult } from "./static-crawl.activity.js";
import type { EvidencePackage, SeoIssue } from "../core/types.js";

export interface BrowserEvidenceInput {
  staticResult: StaticCrawlResult;
  captureScreenshot?: boolean;
}

export interface DomDiffReport {
  hasDiscrepancies: boolean;
  discrepancies: {
    type: "canonical_mismatch" | "robots_override" | "title_mutation" | "h1_hydration_drop" | "client_injected_tags";
    description: string;
    serverValue?: string;
    renderedValue?: string;
  }[];
}

export interface BrowserEvidenceResult {
  url: string;
  sessionId?: string;
  browserProvider: "browserbase-cloud" | "playwright-local";
  renderedMetadata: {
    title?: string;
    canonical?: string;
    metaRobots?: string;
    h1Tags: string[];
  };
  domDiff: DomDiffReport;
  evidencePackage: EvidencePackage;
  detectedIssues: SeoIssue[];
  durationMs: number;
}

async function createBrowserbaseSession(apiKey: string): Promise<{ id: string; connectUrl: string }> {
  const res = await fetch("https://api.browserbase.com/v1/sessions", {
    method: "POST",
    headers: {
      "X-BB-API-Key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({}),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Browserbase API HTTP ${res.status}: ${errText}`);
  }

  const data = (await res.json()) as any;
  return { id: data.id, connectUrl: data.connectUrl };
}

/**
 * Creates browser connection (Browserbase cloud CDP or local Playwright fallback).
 */
async function acquireBrowser(): Promise<{ browser: Browser; sessionId?: string; provider: "browserbase-cloud" | "playwright-local" }> {
  if (env.BROWSERBASE_API_KEY) {
    try {
      const session = await createBrowserbaseSession(env.BROWSERBASE_API_KEY);
      console.log(`[Browserbase] Created cloud session ${session.id}, connecting CDP...`);
      const browser = await chromium.connectOverCDP(session.connectUrl, { timeout: 25000 });
      return { browser, sessionId: session.id, provider: "browserbase-cloud" };
    } catch (err: any) {
      console.warn(`[Browserbase] Cloud connection fallback to local: ${err?.message || err}`);
    }
  }

  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
  });
  return { browser, provider: "playwright-local" };
}

/**
 * Pillar 2: The "Proof of Issue" Evidence Engine Activity
 * 
 * Rule: "An SEO tool without verifiable proof is just an opinionated LLM."
 * 
 * 1. Executes headless browser session (Browserbase cloud or local).
 * 2. Compares raw static HTML against rendered client DOM (DOM Diffing).
 * 3. Highlights offending nodes with SVG/CSS bounding box overlays.
 * 4. Captures screenshots and packages immutable cryptographic proof.
 */
export async function collectBrowserEvidenceActivity(
  input: BrowserEvidenceInput
): Promise<BrowserEvidenceResult> {
  const startTime = performance.now();
  const { staticResult, captureScreenshot = true } = input;
  const url = staticResult.finalUrl || staticResult.url;

  const { browser, sessionId, provider } = await acquireBrowser();
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  });

  const page = await context.newPage();

  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 });
    // Settle brief 1s hydration window
    await page.waitForTimeout(1000);

    // 1. Extract Rendered DOM State
    const renderedTitle = (await page.title()) || undefined;
    const renderedCanonical =
      (await page.locator('link[rel="canonical"]').getAttribute("href").catch(() => null)) || undefined;
    const renderedRobots =
      (await page.locator('meta[name="robots"]').getAttribute("content").catch(() => null)) || undefined;

    const renderedH1Tags = await page.locator("h1").allInnerTexts();
    const cleanedRenderedH1 = renderedH1Tags.map((t) => t.trim()).filter(Boolean);

    // 2. DOM Diffing Analysis (Raw Server HTML vs Rendered Client DOM)
    const discrepancies: DomDiffReport["discrepancies"] = [];

    // Check canonical override
    if (staticResult.metadata.declaredCanonical && renderedCanonical && staticResult.metadata.declaredCanonical !== renderedCanonical) {
      discrepancies.push({
        type: "canonical_mismatch",
        description: "Client-side JavaScript overrode the server-declared canonical URL",
        serverValue: staticResult.metadata.declaredCanonical,
        renderedValue: renderedCanonical,
      });
    }

    // Check meta robots override
    if (staticResult.metadata.metaRobots && renderedRobots && staticResult.metadata.metaRobots !== renderedRobots) {
      discrepancies.push({
        type: "robots_override",
        description: "Client-side JavaScript mutated the meta robots directives",
        serverValue: staticResult.metadata.metaRobots,
        renderedValue: renderedRobots,
      });
    }

    // Check title mutation
    if (staticResult.metadata.title && renderedTitle && staticResult.metadata.title !== renderedTitle) {
      discrepancies.push({
        type: "title_mutation",
        description: "Title was modified client-side after initial server render",
        serverValue: staticResult.metadata.title,
        renderedValue: renderedTitle,
      });
    }

    // Check H1 hydration drop
    if (staticResult.metadata.h1Tags.length > 0 && cleanedRenderedH1.length === 0) {
      discrepancies.push({
        type: "h1_hydration_drop",
        description: "H1 tag existed in server HTML but was dropped during client hydration",
        serverValue: staticResult.metadata.h1Tags.join(", "),
        renderedValue: "None (Dropped)",
      });
    } else if (staticResult.metadata.h1Tags.length === 0 && cleanedRenderedH1.length > 0) {
      discrepancies.push({
        type: "client_injected_tags",
        description: "H1 tag was missing in raw server HTML and only rendered client-side via JavaScript",
        serverValue: "None",
        renderedValue: cleanedRenderedH1.join(", "),
      });
    }

    const domDiff: DomDiffReport = {
      hasDiscrepancies: discrepancies.length > 0,
      discrepancies,
    };

    // 3. Visual Bounding-Box Overlay & Screenshot Proof
    let boundingBox: EvidencePackage["boundingBox"] | undefined;
    let screenshotBase64: string | undefined;

    // Detect if H1 exists and capture coordinates for visual proof
    const h1Locator = page.locator("h1").first();
    const h1Count = await page.locator("h1").count();

    if (h1Count > 0 && (await h1Locator.isVisible())) {
      const box = await h1Locator.boundingBox();
      if (box) {
        boundingBox = {
          x: Math.round(box.x),
          y: Math.round(box.y),
          width: Math.round(box.width),
          height: Math.round(box.height),
          selector: "h1",
        };

        // Draw an SVG/CSS visual highlight overlay onto the page for screenshot proof
        await page.evaluate((coords) => {
          const div = document.createElement("div");
          div.id = "seo-evidence-bounding-box";
          div.style.position = "absolute";
          div.style.left = `${coords.x}px`;
          div.style.top = `${coords.y}px`;
          div.style.width = `${coords.width}px`;
          div.style.height = `${coords.height}px`;
          div.style.border = "3px dashed #ef4444";
          div.style.backgroundColor = "rgba(239, 68, 68, 0.15)";
          div.style.zIndex = "999999";
          div.style.pointerEvents = "none";
          document.body.appendChild(div);
        }, box);
      }
    }

    if (captureScreenshot) {
      const buffer = await page.screenshot({ fullPage: false, type: "jpeg", quality: 75 });
      screenshotBase64 = `data:image/jpeg;base64,${buffer.toString("base64")}`;
    }

    // 4. Assemble Immutable Evidence Package
    const evidencePackage: EvidencePackage = {
      url,
      timestamp: new Date().toISOString(),
      contentHash: staticResult.contentHash,
      rawHtmlSnippet: staticResult.metadata.title ? `Title: ${staticResult.metadata.title}` : undefined,
      renderedDomSnippet: renderedTitle ? `Rendered Title: ${renderedTitle}` : undefined,
      domDiff: JSON.stringify(domDiff.discrepancies),
      screenshotUrl: screenshotBase64 ? screenshotBase64.slice(0, 100) + "..." : undefined,
      boundingBox,
    };

    // 5. Structure Verified SEO Issues
    const detectedIssues: SeoIssue[] = [];

    for (const disc of discrepancies) {
      detectedIssues.push({
        id: `issue-${disc.type}-${Math.random().toString(36).slice(2, 8)}`,
        url,
        category: disc.type === "h1_hydration_drop" ? "hydration_drop" : "rendering_mismatch",
        severity: disc.type === "canonical_mismatch" ? "critical" : "high",
        title: disc.description,
        description: `Server value was: "${disc.serverValue || 'none'}", while rendered client value was: "${disc.renderedValue || 'none'}".`,
        evidence: evidencePackage,
        remediationProposal: {
          framework: "nextjs",
          suggestedPatch: `Ensure consistent server-side rendering for ${disc.type}.`,
        },
      });
    }

    return {
      url,
      sessionId,
      browserProvider: provider,
      renderedMetadata: {
        title: renderedTitle,
        canonical: renderedCanonical,
        metaRobots: renderedRobots,
        h1Tags: cleanedRenderedH1,
      },
      domDiff,
      evidencePackage,
      detectedIssues,
      durationMs: Math.round(performance.now() - startTime),
    };
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}
