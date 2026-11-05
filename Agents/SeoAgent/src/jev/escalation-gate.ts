import { env } from "../config/env.js";
import type { StaticCrawlResult } from "../activities/static-crawl.activity.js";

export interface DeterministicEscalationCheck {
  shouldEscalate: boolean;
  confidence: number;
  reasons: string[];
}

export interface EscalationDecision {
  decision: "STATIC_COMPLETE" | "ESCALATE_TO_BROWSER";
  requiresBrowser: boolean;
  confidence: number;
  reasons: string[];
  source: "deterministic" | "jev" | "fused";
  durationMs: number;
}

/**
 * High-speed deterministic heuristics for hydration & SPA detection.
 * Evaluates in < 1ms without network calls.
 */
export function evaluateDeterministicEscalation(
  staticResult: StaticCrawlResult
): DeterministicEscalationCheck {
  const reasons: string[] = [];
  const { spaIndicators, metadata, statusCode } = staticResult;

  // 1. Cloudflare / WAF / Anti-bot challenges (403 Forbidden / 503 Service Unavailable on raw fetch)
  if (statusCode === 403 || statusCode === 401 || statusCode === 503) {
    return {
      shouldEscalate: true,
      confidence: 0.98,
      reasons: [
        `HTTP ${statusCode} WAF / bot-protection encountered on raw fetch. Escalate to Browserbase for stealth browser rendering.`,
      ],
    };
  }

  // Don't escalate redirects or standard client/server dead-ends (404 Not Found, 410 Gone)
  if (statusCode >= 300 && statusCode < 400) {
    return { shouldEscalate: false, confidence: 1.0, reasons: ["Redirect response handled statically"] };
  }
  if (statusCode >= 400) {
    return { shouldEscalate: false, confidence: 1.0, reasons: [`HTTP ${statusCode} client/server error`] };
  }

  // 1. Definite Client-Only SPA (Root container with near-empty server body)
  if (spaIndicators.hasRootContainer && spaIndicators.bodyTextLength < 250 && spaIndicators.scriptCount >= 1) {
    reasons.push(
      `Detected client-rendered root container (${spaIndicators.rootContainerId}) with only ${spaIndicators.bodyTextLength} chars in raw HTML`
    );
  }

  // 2. Missing critical tags that require client-side execution to populate
  if (!metadata.title && spaIndicators.scriptCount >= 2) {
    reasons.push("Missing <title> tag in raw HTML with active JavaScript bundles detected");
  }

  // 3. No H1 tag found on an otherwise functional landing page
  if (metadata.h1Tags.length === 0 && spaIndicators.bodyTextLength < 500 && spaIndicators.scriptCount >= 2) {
    reasons.push("Empty <h1> tags in raw server payload; dynamic client rendering suspected");
  }

  const shouldEscalate = reasons.length > 0;
  const confidence = reasons.length >= 2 ? 0.95 : reasons.length === 1 ? 0.80 : 0.10;

  return {
    shouldEscalate,
    confidence,
    reasons,
  };
}

/**
 * JEV Hydration & Escalation Gate
 * 
 * Rule: "Never launch a browser session for what raw HTTP can do in 8ms."
 * 
 * 1. Runs deterministic heuristics (< 1ms).
 * 2. If deterministic confidence is high (>= 0.90), returns immediately.
 * 3. For nuanced or edge cases, queries TypeSafe JEV Decisions (OpenRouter) with `requires_browser_rendering`.
 */
export async function evaluateEscalationGate(
  staticResult: StaticCrawlResult,
  timeoutMs = 1500
): Promise<EscalationDecision> {
  const startTime = performance.now();

  // Step 1: Deterministic check
  const deterministic = evaluateDeterministicEscalation(staticResult);

  // If deterministic signals are unambiguous, exit immediately without API latency/cost
  if (deterministic.confidence >= 0.90) {
    return {
      decision: deterministic.shouldEscalate ? "ESCALATE_TO_BROWSER" : "STATIC_COMPLETE",
      requiresBrowser: deterministic.shouldEscalate,
      confidence: deterministic.confidence,
      reasons: deterministic.reasons.length > 0 ? deterministic.reasons : ["Complete static SSR payload verified"],
      source: "deterministic",
      durationMs: Math.round(performance.now() - startTime),
    };
  }

  // Step 2: Query JEV Decisions API for semantic hydration & intent routing
  const openrouterApiKey = env.OPENROUTER_JEV || process.env.OPENROUTER_JEV;
  if (!openrouterApiKey) {
    // If no JEV key, rely strictly on deterministic evaluation
    return {
      decision: deterministic.shouldEscalate ? "ESCALATE_TO_BROWSER" : "STATIC_COMPLETE",
      requiresBrowser: deterministic.shouldEscalate,
      confidence: deterministic.confidence,
      reasons: deterministic.reasons.length > 0 ? deterministic.reasons : ["Static crawl sufficient (deterministic baseline)"],
      source: "deterministic",
      durationMs: Math.round(performance.now() - startTime),
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch("https://openrouter.ai/api/alpha/decisions", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Authorization": `Bearer ${openrouterApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: env.JEV_MODEL || "typesafe/jev-1.14",
        state: {
          url: staticResult.url,
          status_code: staticResult.statusCode,
          body_text_length: staticResult.spaIndicators.bodyTextLength,
          has_root_container: staticResult.spaIndicators.hasRootContainer,
          script_count: staticResult.spaIndicators.scriptCount,
          has_title: Boolean(staticResult.metadata.title),
          has_canonical: Boolean(staticResult.metadata.declaredCanonical),
          h1_count: staticResult.metadata.h1Tags.length,
          deterministic_flags: deterministic.reasons.join(", ") || "none",
        },
        questions: {
          requires_browser_rendering: {
            type: "noul",
            instructions:
              "Does this web page require a full headless browser session to execute client-side JavaScript, hydrate dynamic content, and reveal missing SEO tags?",
            criteria: {
              true: "Page is a single-page app (React/Vue/Angular), content is rendered client-side, critical tags or body text are missing from raw HTML, or visual rendering is required.",
              false: "Page is server-side rendered (SSR) or static HTML with full text, complete meta tags, and rendered content."
            }
          }
        }
      })
    });

    clearTimeout(timer);

    if (res.ok) {
      const data = (await res.json()) as any;
      const jevScore = data.answers?.requires_browser_rendering?.noul ?? 0.0;

      // Fused policy: JEV probability + deterministic findings
      const requiresBrowser = jevScore >= 0.50 || (deterministic.shouldEscalate && jevScore >= 0.35);
      const combinedReasons = [...deterministic.reasons];
      if (jevScore >= 0.50) {
        combinedReasons.push(`JEV classified dynamic browser requirement (probability: ${jevScore.toFixed(2)})`);
      }

      return {
        decision: requiresBrowser ? "ESCALATE_TO_BROWSER" : "STATIC_COMPLETE",
        requiresBrowser,
        confidence: parseFloat(jevScore.toFixed(2)),
        reasons: combinedReasons.length > 0 ? combinedReasons : ["Static HTML payload confirmed sufficient by JEV"],
        source: "fused",
        durationMs: Math.round(performance.now() - startTime),
      };
    }
  } catch {
    // Fail-safe to deterministic check if JEV timeout/error occurs
  } finally {
    clearTimeout(timer);
  }

  return {
    decision: deterministic.shouldEscalate ? "ESCALATE_TO_BROWSER" : "STATIC_COMPLETE",
    requiresBrowser: deterministic.shouldEscalate,
    confidence: deterministic.confidence,
    reasons: deterministic.reasons.length > 0 ? deterministic.reasons : ["Fallback to deterministic static baseline"],
    source: "deterministic",
    durationMs: Math.round(performance.now() - startTime),
  };
}
