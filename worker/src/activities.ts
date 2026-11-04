import { ApplicationFailure } from "@temporalio/activity";

type Status = "running" | "succeeded" | "failed" | "cancelled";

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw ApplicationFailure.nonRetryable(`${name} is not set`);
  return value;
}

/** Reports run state to the Convex gateway. Retried by Temporal; 4xx answers are final. */
export async function setRunStatus(
  runId: string,
  status: Status,
  error?: { code: string; message: string },
): Promise<void> {
  const res = await fetch(`${env("CONVEX_SITE_URL")}/worker/run-status`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${env("WORKER_SECRET")}` },
    body: JSON.stringify({ runId, status, error }),
  });
  // 409 = already finished (e.g. a retried call), so there is nothing left to do
  if (res.ok || res.status === 409) return;
  if (res.status >= 400 && res.status < 500) {
    throw ApplicationFailure.nonRetryable(`Convex rejected status update (${res.status})`);
  }
  throw new Error(`Convex status update failed (${res.status})`);
}
