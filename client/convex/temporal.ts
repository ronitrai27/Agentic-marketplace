"use node";

import { action, internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { ConvexError, v } from "convex/values";
import { Client, Connection } from "@temporalio/client";

const DEFAULT_TASK_QUEUE = "catelog-agent-runs";
/** Inputs above this go to file storage. Above MAX they are refused. */
const INLINE_INPUT_CHARS = 400_000;
const MAX_INPUT_CHARS = 12_000_000;

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

/**
 * Step after the input form: queues the run (checks the agent's SDK limits) and starts its workflow.
 * If Temporal can't be reached the run is closed and the payment hold is released.
 */
export const start = action({
  args: {
    runId: v.id("runs"),
    inputJson: v.string(),
    /** Caller's address and region as seen by our Next.js edge (/api/client-info). */
    clientIp: v.optional(v.string()),
    clientRegion: v.optional(v.string()),
  },
  handler: async (ctx, { runId, inputJson, clientIp, clientRegion }): Promise<{ ok: true }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Please sign in." });

    if (inputJson.length > MAX_INPUT_CHARS) {
      throw new ConvexError({ code: "PAYLOAD_TOO_LARGE", message: "Your input is too large (limit is about 8 MB)." });
    }
    try {
      const parsed = JSON.parse(inputJson);
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    } catch {
      throw new ConvexError({ code: "INVALID_INPUT", message: "Input must be a JSON object." });
    }

    // Uploaded files make the input big: keep it in file storage (deleted when the run ends), not in the run row
    const stored = inputJson.length > INLINE_INPUT_CHARS
      ? await ctx.storage.store(new Blob([inputJson], { type: "application/json" }))
      : undefined;
    const begun = await ctx.runMutation(internal.runs.beginRun, {
      runId,
      userId: identity.subject,
      clientIp: clientIp?.slice(0, 64),
      clientRegion: clientRegion?.slice(0, 64),
      ...(stored ? { inputStorageId: stored } : { inputJson }),
    });
    if (!begun.ok) {
      if (stored) await ctx.storage.delete(stored).catch(() => {});
      throw new ConvexError({ code: begun.code, message: begun.message });
    }

    try {
      const client = await getClient();
      await client.workflow.start("runAgentWorkflow", {
        taskQueue: process.env.TEMPORAL_TASK_QUEUE ?? DEFAULT_TASK_QUEUE,
        workflowId: `run-${runId}`,
        args: [{ runId, timeoutSeconds: begun.timeoutSeconds }],
        workflowExecutionTimeout: `${begun.timeoutSeconds + 300} seconds`,
      });
    } catch (err) {
      console.error("start: workflow start failed", err);
      const message = "Could not start the run. Nothing was charged.";
      await ctx.runMutation(internal.runs.setStatus, {
        runId,
        status: "failed",
        error: { code: "WORKFLOW_START_FAILED", message },
      });
      throw new ConvexError({ code: "WORKFLOW_START_FAILED", message });
    }
    return { ok: true };
  },
});
