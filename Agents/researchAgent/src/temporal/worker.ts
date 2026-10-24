import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NativeConnection, Worker } from "@temporalio/worker";
import * as activities from "./activities.js";
import { ENV } from "../config/env.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function run() {
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

  const connection = await NativeConnection.connect({
    address,
    apiKey: apiKey || undefined,
    tls: apiKey ? true : false,
  });

  // Resolve workflows file for tsx (development) or compiled node (production)
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

  console.log(`✅ Worker registered and polling for tasks on [${taskQueue}]...`);
  console.log(`   Press Ctrl+C to terminate.\n`);

  await worker.run();
}

run().catch((err) => {
  console.error("❌ [Temporal Worker Fatal Error]:", err);
  process.exit(1);
});
