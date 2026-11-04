import { reportStatus, type RunFailure, type Status } from "./convex";

export { executeAgent } from "./execute";

/** Reports run state to the Convex gateway. Retried by Temporal. */
export async function setRunStatus(runId: string, status: Status, error?: RunFailure): Promise<void> {
  await reportStatus(runId, status, error);
}
