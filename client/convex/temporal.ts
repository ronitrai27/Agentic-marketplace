"use node";

import { internalAction } from "./_generated/server";
import { v } from "convex/values";
import { Client, Connection } from "@temporalio/client";

const DEFAULT_TASK_QUEUE = "catelog-agent-runs";

let clientPromise: Promise<Client> | undefined;

/** One Temporal Cloud connection per warm action container. Config lives only in Convex env vars. */
function getClient(): Promise<Client> {
  clientPromise ??= (async () => {
    const address = process.env.TEMPORAL_ADDRESS;
    const namespace = process.env.TEMPORAL_NAMESPACE;
    const apiKey = process.env.TEMPORAL_API_KEY;
    if (!address || !namespace || !apiKey) throw new Error("Temporal is not configured");
    const connection = await Connection.connect({ address, tls: true, apiKey });
    return new Client({ connection, namespace });
  })().catch((err) => {
    clientPromise = undefined;
    throw err;
  });
  return clientPromise;
}

/**
 * Starts the universal run workflow. The workflow input is ids only: the worker looks the agent up
 * itself, so the agent's URL never passes through here.
 * workflowId = run-<runId>, so a repeated start for the same run is rejected instead of doubling it.
 */
export const startRunWorkflow = internalAction({
  args: { runId: v.string(), timeoutSeconds: v.number() },
  handler: async (_ctx, { runId, timeoutSeconds }): Promise<{ workflowId: string }> => {
    const client = await getClient();
    const workflowId = `run-${runId}`;
    await client.workflow.start("runAgentWorkflow", {
      taskQueue: process.env.TEMPORAL_TASK_QUEUE ?? DEFAULT_TASK_QUEUE,
      workflowId,
      args: [{ runId, timeoutSeconds }],
      // Agent timeout plus room for status writes and retries
      workflowExecutionTimeout: `${timeoutSeconds + 300} seconds`,
    });
    return { workflowId };
  },
});
