import { createTemporalClient } from "./connection.js";
import { env } from "../config/env.js";
import { healthCheckWorkflow, staticCrawlWorkflow } from "./workflows/index.js";
import { randomUUID } from "node:crypto";

async function main() {
  const targetUrl = process.argv[2] || "https://example.com";

  console.log(`📡 Connecting Temporal Client to ${env.TEMPORAL_ADDRESS}...`);
  const client = await createTemporalClient();

  // Test 1: Healthcheck
  const healthCheckId = `healthcheck-${randomUUID()}`;
  console.log(`\n🩺 [Test 1] Starting healthCheckWorkflow (ID: ${healthCheckId})...`);
  const healthResult = await client.workflow.execute(healthCheckWorkflow, {
    taskQueue: env.TEMPORAL_TASK_QUEUE,
    workflowId: healthCheckId,
    args: [{ pingMessage: "Temporal Cloud Connection Active!" }],
  });
  console.log("✅ HealthCheck Result:", healthResult);

  // Test 2: Static Crawl (Pillar 1)
  const crawlId = `crawl-${randomUUID()}`;
  console.log(`\n🕷️ [Test 2] Starting staticCrawlWorkflow for ${targetUrl} (ID: ${crawlId})...`);
  const crawlResult = await client.workflow.execute(staticCrawlWorkflow, {
    taskQueue: env.TEMPORAL_TASK_QUEUE,
    workflowId: crawlId,
    args: [{ url: targetUrl, timeoutMs: 8000 }],
  });

  console.log("\n🎯 Crawl Execution Summary:");
  console.log(`- Status: ${crawlResult.statusCode} (${crawlResult.finalUrl})`);
  console.log(`- Fetch Latency: ${crawlResult.timing.fetchDurationMs}ms | Parse Latency: ${crawlResult.timing.parseDurationMs}ms | Total: ${crawlResult.timing.totalDurationMs}ms`);
  console.log(`- Content SHA-256: ${crawlResult.contentHash}`);
  console.log(`- Title: "${crawlResult.metadata.title}"`);
  console.log(`- Declared Canonical: ${crawlResult.metadata.declaredCanonical || "None"}`);
  console.log(`- Meta Robots: ${crawlResult.metadata.metaRobots || "None"}`);
  console.log(`- H1 Tags:`, crawlResult.metadata.h1Tags);
  console.log(`- Structured Data (JSON-LD): ${crawlResult.metadata.structuredData.length} items found`);
  console.log(`- SPA Check: isPotentialClientOnlySpa=${crawlResult.spaIndicators.isPotentialClientOnlySpa}`);
}

main().catch((err) => {
  console.error("❌ Execution error:", err);
  process.exit(1);
});
