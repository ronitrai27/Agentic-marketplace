import { proxyActivities } from "@temporalio/workflow";
import type * as activities from "./activities";

const { setRunStatus } = proxyActivities<typeof activities>({
  startToCloseTimeout: "30 seconds",
  retry: { initialInterval: "1 second", backoffCoefficient: 2, maximumInterval: "30 seconds", maximumAttempts: 10 },
});

export interface RunAgentInput {
  runId: string;
  timeoutSeconds: number;
}

/**
 * Universal workflow behind every marketplace run, started by the Convex gateway.
 * The input is ids only. Agent URLs are looked up inside activities, never put in workflow history.
 */
export async function runAgentWorkflow({ runId }: RunAgentInput): Promise<void> {
  await setRunStatus(runId, "running");

  // NEXT STEP: callAgent activity (resolve baseUrl server-side, SSRF guard, signed request,
  // timeout = timeoutSeconds, heartbeat) and record its output.
  // Until it exists the run is closed explicitly so it never sits "running" and holds a slot.
  await setRunStatus(runId, "failed", {
    code: "AGENT_EXECUTION_NOT_WIRED",
    message: "Agent execution is not enabled yet",
  });
}
