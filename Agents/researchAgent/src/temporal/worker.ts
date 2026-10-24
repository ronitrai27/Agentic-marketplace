import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NativeConnection, Worker } from "@temporalio/worker";
import * as activities from "./activities.js";
import { ENV } from "../config/env.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let activeWorker: Worker | null = null;
let isStarting = false;

/**
 * Initializes and starts the Temporal Worker.
 * Can be called standalone or embedded inside the web server process.
 */
export async function startWorker(): Promise<Worker> {
  if (activeWorker) {
    return activeWorker;
  }
  if (isStarting) {
    // Wait until started
    while (isStarting) {
      await new Promise((r) => setTimeout(r, 100));
    }
    if (activeWorker) return activeWorker;
  }

  isStarting = true;

  const address = ENV.TEMPORAL_ADDRESS;
  const namespace = ENV.TEMPORAL_NAMESPACE;
  const apiKey = ENV.TEMPORAL_API_KEY;
  const taskQueue = ENV.TEMPORAL_TASK_QUEUE;

  console.log(`\n======================================================`);
  console.log(`👷 Initializing Temporal Deep Research Worker...`);
  console.log(`   - Address:    ${address}`);
  console.log(`   - Namespace:  ${namespace}`);
  console.log(`   - Task Queue: ${taskQueue}`);
  console.log(`   - Mode:       ${apiKey ? "Temporal Cloud (TLS + API Key)" : "Local Dev Server"}`);
  console.log(`======================================================\n`);

  try {
    const connection = await NativeConnection.connect({
      address,
      apiKey: apiKey || undefined,
      tls: apiKey ? true : false,
    });

    const tsPath = path.resolve(__dirname, "./workflows.ts");
    const jsPath = path.resolve(__dirname, "./workflows.js");
    const workflowsPath = fs.existsSync(tsPath) ? tsPath : jsPath;

    const worker = await Worker.create({
      connection,
      namespace,
      taskQueue,
      workflowsPath,
      activities,
    });

    console.log(`✅ [Temporal Worker] Polling tasks on queue [${taskQueue}]!`);

    // Run worker in background
    worker.run().catch((err) => {
      console.error("❌ [Temporal Worker Execution Error]:", err);
    });

    activeWorker = worker;
    isStarting = false;
    return worker;
  } catch (err) {
    isStarting = false;
    throw err;
  }
}

// If executed directly from command line (e.g. `npm run worker`)
if (
  process.argv[1]?.endsWith("worker.ts") ||
  process.argv[1]?.endsWith("worker.js")
) {
  startWorker().catch((err) => {
    console.error("❌ [Temporal Worker Fatal Error]:", err);
    process.exit(1);
  });
}
