import { proxyActivities } from "@temporalio/workflow";
import type * as activities from "../../activities/static-crawl.activity.js";

const { staticCrawlActivity } = proxyActivities<typeof activities>({
  startToCloseTimeout: "30 seconds",
  retry: {
    initialInterval: "1 second",
    maximumInterval: "10 seconds",
    backoffCoefficient: 2,
    maximumAttempts: 3,
  },
});

export interface StaticCrawlWorkflowInput {
  url: string;
  timeoutMs?: number;
}

/**
 * Durable Workflow for Static Crawl Inspection.
 * Survives network drops, retries with exponential backoff, and checkpoints results.
 */
export async function staticCrawlWorkflow(
  input: StaticCrawlWorkflowInput
): Promise<ReturnType<typeof staticCrawlActivity>> {
  return await staticCrawlActivity({
    url: input.url,
    timeoutMs: input.timeoutMs,
  });
}
