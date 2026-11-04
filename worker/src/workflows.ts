import { proxyActivities } from "@temporalio/workflow";
import type * as activities from "./activities";

const { setRunStatus } = proxyActivities<typeof activities>({
  startToCloseTimeout: "60 seconds",
  retry: { initialInterval: "1 second", backoffCoefficient: 2, maximumInterval: "30 seconds", maximumAttempts: 10 },
});

export interface RunAgentInput {
  runId: string;
  timeoutSeconds: number;
}

/**
 * Universal workflow behind every marketplace run, started by the Convex gateway.
 * The input is ids only. The agent's URL and signing key are looked up inside the activity, never in workflow history.
 */
export async function runAgentWorkflow({ runId, timeoutSeconds }: RunAgentInput): Promise<void> {
  // An agent run is never retried automatically: it can cost money and the agent rejects a repeated run id.
  const { executeAgent } = proxyActivities<typeof activities>({
    startToCloseTimeout: `${timeoutSeconds + 120} seconds`,
    heartbeatTimeout: "90 seconds",
    retry: { maximumAttempts: 1 },
  });

  await setRunStatus(runId, "running");
  try {
    await executeAgent(runId);
  } catch {
    // The worker died, lost heartbeat, or timed out. Close the run so the hold is released.
    await setRunStatus(runId, "failed", {
      code: "RUN_INTERRUPTED",
      message: "The run was interrupted. Nothing was charged.",
    });
  }
}
