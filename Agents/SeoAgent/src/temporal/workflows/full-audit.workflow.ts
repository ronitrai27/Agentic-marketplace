import { proxyActivities } from "@temporalio/workflow";
import type * as activities from "../../activities/index.js";

const {
  staticCrawlActivity,
  firecrawlScrapeActivity,
  escalationGateActivity,
  collectBrowserEvidenceActivity,
  groundTruthActivity,
  geoSemanticActivity,
  linkGraphActivity,
} = proxyActivities<typeof activities>({
  startToCloseTimeout: "120 seconds",
  retry: {
    initialInterval: "1 second",
    maximumInterval: "10 seconds",
    backoffCoefficient: 2,
    maximumAttempts: 3,
  },
});

export interface FullAuditWorkflowInput {
  url: string;
  companyName?: string;
  forceBrowser?: boolean;
}

export interface FullAuditWorkflowResult {
  url: string;
  staticResult: Awaited<ReturnType<typeof staticCrawlActivity>>;
  firecrawlResult: Awaited<ReturnType<typeof firecrawlScrapeActivity>>;
  escalationDecision: Awaited<ReturnType<typeof escalationGateActivity>>;
  browserEvidence?: Awaited<ReturnType<typeof collectBrowserEvidenceActivity>>;
  groundTruth: Awaited<ReturnType<typeof groundTruthActivity>>;
  geoSemantic: Awaited<ReturnType<typeof geoSemanticActivity>>;
  linkGraph: Awaited<ReturnType<typeof linkGraphActivity>>;
  completedAt: string;
}

/**
 * Enterprise Full SEO & GEO Durable Workflow
 * 
 * Orchestrates all 5 pillars plus Firecrawl scraping as durable Temporal activities.
 * Operates with 99.99% durability on Temporal Cloud with automated retries.
 */
export async function fullAuditWorkflow(
  input: FullAuditWorkflowInput
): Promise<FullAuditWorkflowResult> {
  const url = input.url;

  // Step 1: Execute Fast Static Ingestion and Firecrawl Scrape in parallel
  const [staticResult, firecrawlResult] = await Promise.all([
    staticCrawlActivity({ url }),
    firecrawlScrapeActivity({ url }),
  ]);

  const brand =
    input.companyName ||
    staticResult.metadata.title?.split(/[-|]/)[0]?.trim() ||
    "Brand";

  // Step 2: JEV Hydration & Escalation Gate
  const escalationDecision = await escalationGateActivity(staticResult);

  // Step 3: Run Browserbase Cloud Session if JEV flags browser requirement OR user forced browser session
  let browserEvidence;
  if (input.forceBrowser || escalationDecision.requiresBrowser) {
    browserEvidence = await collectBrowserEvidenceActivity({ staticResult });
  }

  // Step 4: Run Ground Truth, GEO Citations, and Link Graph concurrently
  const [groundTruth, geoSemantic, linkGraph] = await Promise.all([
    groundTruthActivity({ url, targetKeyword: brand }),
    geoSemanticActivity({
      targetDomain: new URL(url).hostname,
      samplePages: [
        {
          url,
          title: staticResult.metadata.title || "Home",
          description: staticResult.metadata.metaDescription,
        },
      ],
      testQuery: brand,
    }),
    linkGraphActivity({
      rootUrl: url,
      pages: [{ url, internalLinks: [] }],
    }),
  ]);

  return {
    url,
    staticResult,
    firecrawlResult,
    escalationDecision,
    browserEvidence,
    groundTruth,
    geoSemantic,
    linkGraph,
    completedAt: new Date().toISOString(),
  };
}
