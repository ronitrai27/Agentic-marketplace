import { proxyActivities } from "@temporalio/workflow";
import type * as activities from "../../activities/index.js";
import type { SeoIssue } from "../../core/types.js";

const { staticCrawlActivity, escalationGateActivity, collectBrowserEvidenceActivity } = proxyActivities<typeof activities>({
  startToCloseTimeout: "60 seconds",
  retry: {
    initialInterval: "1 second",
    maximumInterval: "10 seconds",
    backoffCoefficient: 2,
    maximumAttempts: 3,
  },
});

export interface DualTierCrawlWorkflowInput {
  url: string;
}

export interface DualTierCrawlWorkflowResult {
  url: string;
  staticResult: Awaited<ReturnType<typeof staticCrawlActivity>>;
  escalationDecision: Awaited<ReturnType<typeof escalationGateActivity>>;
  browserEvidence?: Awaited<ReturnType<typeof collectBrowserEvidenceActivity>>;
  issues: SeoIssue[];
  tierCompleted: "TIER_1_STATIC" | "TIER_2_BROWSER";
}

/**
 * Dual-Tier Crawl Engine Workflow
 * 
 * Step 1: Fast static crawl via Undici (sub-150ms)
 * Step 2: JEV Hydration & Escalation Gate
 * Step 3: Browserbase / Playwright Evidence Engine (if escalated)
 */
export async function dualTierCrawlWorkflow(
  input: DualTierCrawlWorkflowInput
): Promise<DualTierCrawlWorkflowResult> {
  // Tier 1: Static Fast Pass
  const staticResult = await staticCrawlActivity({ url: input.url });

  // Routing Gate: JEV + Deterministic Check
  const escalationDecision = await escalationGateActivity(staticResult);

  // If static pass is sufficient, return immediately ($0 browser cost, 150ms execution)
  if (escalationDecision.decision === "STATIC_COMPLETE") {
    return {
      url: input.url,
      staticResult,
      escalationDecision,
      issues: [],
      tierCompleted: "TIER_1_STATIC",
    };
  }

  // Tier 2: Browserbase / Playwright Evidence Collector
  const browserEvidence = await collectBrowserEvidenceActivity({ staticResult });

  return {
    url: input.url,
    staticResult,
    escalationDecision,
    browserEvidence,
    issues: browserEvidence.detectedIssues,
    tierCompleted: "TIER_2_BROWSER",
  };
}
