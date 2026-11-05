import { Worker } from "@temporalio/worker";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createNativeConnection, TEMPORAL_CONFIG } from "./connection.js";
import * as activities from "./activities.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function runWorker() {
  console.log(`[Temporal Worker] Connecting to ${TEMPORAL_CONFIG.address}...`);
  console.log(`[Temporal Worker] Namespace: ${TEMPORAL_CONFIG.namespace}`);
  console.log(`[Temporal Worker] Task Queue: ${TEMPORAL_CONFIG.taskQueue}`);

  const connection = await createNativeConnection();

  const tsWorkflowsPath = path.join(__dirname, "workflows", "index.ts");
  const jsWorkflowsPath = path.join(__dirname, "workflows", "index.js");

  const workflowsPath = (await import("node:fs")).existsSync(tsWorkflowsPath)
    ? tsWorkflowsPath
    : jsWorkflowsPath;

  const worker = await Worker.create({
    connection,
    namespace: TEMPORAL_CONFIG.namespace,
    taskQueue: TEMPORAL_CONFIG.taskQueue,
    workflowsPath,
    activities,
  });

  console.log(`✅ [Temporal Worker] Listening on Task Queue: "${TEMPORAL_CONFIG.taskQueue}"`);
  await worker.run();
}

// Auto-run if executed directly
if (process.argv[1] && process.argv[1].includes("worker")) {
  runWorker().catch((err) => {
    console.error("❌ [Temporal Worker] Fatal crash:", err);
    process.exit(1);
  });
}
