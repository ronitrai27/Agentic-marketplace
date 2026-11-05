import { env } from "../config/env.js";
import type { UsageTracker } from "./usage.js";

export interface ResolvedAuditTarget {
  isAuditIntent: boolean;
  targetUrl: string | null;
  companyName?: string;
  confidence: number;
  reason?: string;
  source: "deterministic" | "jev";
}

const DOMAIN_REGEX =
  /(?:https?:\/\/)?(?:www\.)?([a-zA-Z0-9][-a-zA-Z0-9]*\.[a-zA-Z]{2,}(?:\/[^\s]*)?)/i;

/**
 * Enterprise Target & Intent Resolver.
 * NO LLM generation — 100% deterministic & TypeSafe JEV Decisions.
 *
 * Tier 1: Deterministic domain pattern recognition (< 1ms) for www.*, bare domains, full URLs.
 * Tier 2: OpenRouter TypeSafe JEV Decisions API (noul decision) for brand/natural language intents + SerpApi discovery.
 */
export async function resolveAuditTarget(
  query: string,
  usage?: UsageTracker,
): Promise<ResolvedAuditTarget> {
  const trimmed = query.trim();
  if (!trimmed) {
    return {
      isAuditIntent: false,
      targetUrl: null,
      confidence: 0,
      source: "deterministic",
    };
  }

  // ----------------------------------------------------
  // Tier 1: Zero-latency deterministic domain / URL check (< 1ms)
  // ----------------------------------------------------
  const match = trimmed.match(DOMAIN_REGEX);
  if (match && match[0]) {
    let raw = match[0].replace(/[),.;]+$/, "");
    if (!/^https?:\/\//i.test(raw)) {
      raw = `https://${raw}`;
    }
    try {
      const parsed = new URL(raw);
      const company = parsed.hostname.replace(/^www\./, "").split(".")[0];
      return {
        isAuditIntent: true,
        targetUrl: parsed.toString(),
        companyName: company,
        confidence: 1.0,
        reason: "Direct domain/URL extracted",
        source: "deterministic",
      };
    } catch {
      // Fall through to Tier 2
    }
  }

  // ----------------------------------------------------
  // Tier 2: TypeSafe JEV Decisions API via OpenRouter (NO generative LLM)
  // ----------------------------------------------------
  const openrouterApiKey = env.OPENROUTER_JEV || process.env.OPENROUTER_JEV;
  if (!openrouterApiKey) {
    return {
      isAuditIntent: false,
      targetUrl: null,
      confidence: 0,
      source: "deterministic",
    };
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2000);

    const res = await fetch("https://openrouter.ai/api/alpha/decisions", {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${openrouterApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: env.JEV_MODEL || "typesafe/jev-1.14",
        state: {
          user_prompt: trimmed,
        },
        questions: {
          is_audit_or_web_inspection_request: {
            type: "noul",
            instructions:
              "Does this user message explicitly request to audit, inspect, analyze, browse, visit, or check a website, product, or company?",
            criteria: {
              true: "User specifies a website, company, or brand to inspect, browse, audit, or learn about (e.g. 'go to wekraft - a project management platform and tell about that', 'check linear app', 'audit stripe').",
              false:
                "General conversation, asking how the assistant works, or asking conceptual questions without asking to inspect a specific target.",
            },
          },
        },
      }),
    });

    clearTimeout(timer);

    if (res.ok) {
      const data = (await res.json()) as any;
      usage?.addProviderUsage(env.JEV_MODEL || "typesafe/jev-1.14", data.usage);
      const jevScore =
        data.answers?.is_audit_or_web_inspection_request?.noul ??
        data.decisions?.is_audit_or_web_inspection_request?.probability ??
        0.0;

      const isAuditIntent = jevScore >= 0.5;

      if (isAuditIntent) {
        // Extract the brand/company name from the prompt deterministically
        const candidate = trimmed
          .replace(
            /^(?:please\s+)?(?:go\s+to|check|audit|inspect|analyze|visit|look\s+at|tell\s+me\s+about)\s+/i,
            "",
          )
          .split(/[\s,-]+/)[0]
          ?.replace(/[^a-zA-Z0-9]/g, "")
          .trim();

        const brand = candidate || "Brand";

        // Query SerpApi to find the official ground-truth website URL
        const serpApiKey = env.SERPAPI_KEY;
        if (serpApiKey && brand) {
          try {
            const serpRes = await fetch(
              `https://serpapi.com/search.json?engine=google&q=${encodeURIComponent(
                `${brand} official website`,
              )}&api_key=${serpApiKey}`,
            );
            if (serpRes.ok) {
              const serpData = (await serpRes.json()) as any;
              const topOrganic = serpData?.organic_results?.[0]?.link;
              if (topOrganic) {
                return {
                  isAuditIntent: true,
                  targetUrl: topOrganic,
                  companyName: brand,
                  confidence: parseFloat(jevScore.toFixed(2)),
                  reason: `JEV classified inspection intent (${jevScore.toFixed(2)}) + SerpApi URL resolved`,
                  source: "jev",
                };
              }
            }
          } catch {
            // Ignore SerpApi error, proceed to fallback
          }
        }

        return {
          isAuditIntent: true,
          targetUrl: `https://www.${brand.toLowerCase()}.com`,
          companyName: brand,
          confidence: parseFloat(jevScore.toFixed(2)),
          reason: `JEV classified inspection intent (${jevScore.toFixed(2)})`,
          source: "jev",
        };
      }
    }
  } catch (err: any) {
    // Fail-safe exit on timeout
  }

  return {
    isAuditIntent: false,
    targetUrl: null,
    confidence: 0.0,
    source: "deterministic",
  };
}
