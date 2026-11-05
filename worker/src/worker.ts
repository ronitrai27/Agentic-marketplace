import { NativeConnection, Worker } from "@temporalio/worker";
import * as activities from "./activities";

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

async function main() {
  const connection = await NativeConnection.connect({
    address: env("TEMPORAL_ADDRESS"),
    tls: true,
    apiKey: env("TEMPORAL_API_KEY"),
  });

  const worker = await Worker.create({
    connection,
    namespace: env("TEMPORAL_NAMESPACE"),
    taskQueue: process.env.TEMPORAL_TASK_QUEUE ?? "catelog-agent-runs",
    workflowsPath: require.resolve("./workflows"),
    activities,
  });

  console.log("catelog worker polling", process.env.TEMPORAL_TASK_QUEUE ?? "catelog-agent-runs");
  await worker.run();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
