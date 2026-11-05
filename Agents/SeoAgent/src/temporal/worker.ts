import { Worker } from "@temporalio/worker";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { env } from "../config/env.js";
import { createNativeConnection } from "./connection.js";
import * as activities from "../activities/index.js";

async function runWorker() {
  console.log(`[Temporal Worker] Connecting to ${env.TEMPORAL_ADDRESS} (Namespace: ${env.TEMPORAL_NAMESPACE})...`);
  
  const connection = await createNativeConnection();

  const tsWorkflowsPath = fileURLToPath(new URL("./workflows/index.ts", import.meta.url));
  const jsWorkflowsPath = fileURLToPath(new URL("./workflows/index.js", import.meta.url));
  const workflowsPath = existsSync(tsWorkflowsPath) ? tsWorkflowsPath : jsWorkflowsPath;

  const worker = await Worker.create({
    connection,
    namespace: env.TEMPORAL_NAMESPACE,
    taskQueue: env.TEMPORAL_TASK_QUEUE,
    workflowsPath,
    activities,
  });

  console.log(`✅ [Temporal Worker] Listening on Task Queue: "${env.TEMPORAL_TASK_QUEUE}"`);
  console.log(`Registered workflows: healthCheckWorkflow, staticCrawlWorkflow`);
  console.log(`Registered activities: staticCrawlActivity`);

  await worker.run();
}

runWorker().catch((err) => {
  console.error("❌ [Temporal Worker] Fatal crash:", err);
  process.exit(1);
});
