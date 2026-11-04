import { ApplicationFailure } from "@temporalio/activity";

export type Status = "running" | "failed" | "cancelled";
export interface RunFailure {
  code: string;
  message: string;
}

export interface RunContext {
  status: string;
  baseUrl: string;
  agentName: string;
  inputJson: string;
  /** Set when the input is large and was kept in file storage. */
  inputUrl: string | null;
  inputSchemaJson: string;
  outputSchemaJson: string;
  timeoutSeconds: number;
  /** The creator's secret keys, sealed to us. The agent accepts exactly one of them. */
  signingKeys: Array<{ keyId: string; sealed: string }>;
}

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw ApplicationFailure.nonRetryable(`${name} is not set`);
  return value;
}

async function post(path: string, body: unknown): Promise<Response> {
  return fetch(`${env("CONVEX_SITE_URL")}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${env("WORKER_SECRET")}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
}

/** Retries network errors and 5xx. 409 means "already finished", which is fine to ignore. */
async function postWithRetry(path: string, body: unknown): Promise<Response> {
  let last: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await post(path, body);
      if (res.status < 500) return res;
      last = new Error(`Convex ${path} answered ${res.status}`);
    } catch (err) {
      last = err;
    }
    await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
  }
  throw last;
}

export async function getRunContext(runId: string): Promise<RunContext> {
  const res = await postWithRetry("/worker/run-context", { runId });
  if (!res.ok) throw ApplicationFailure.nonRetryable(`Run context unavailable (${res.status})`);
  return (await res.json()) as RunContext;
}

export async function reportStatus(runId: string, status: Status, error?: RunFailure): Promise<void> {
  const res = await postWithRetry("/worker/run-status", { runId, status, error });
  if (!res.ok && res.status !== 409) throw new Error(`Status update rejected (${res.status})`);
}

export async function reportComplete(runId: string, output: unknown): Promise<void> {
  const res = await postWithRetry("/worker/run-complete", { runId, output });
  if (!res.ok && res.status !== 409) throw new Error(`Completion rejected (${res.status})`);
}

export async function rememberSigningKey(runId: string, keyId: string): Promise<void> {
  try {
    await post("/worker/agent-key", { runId, keyId });
  } catch {
    /* only an optimisation: the next run just tries the keys again */
  }
}

export async function reportEvents(runId: string, events: Array<{ type: string; data: unknown }>): Promise<void> {
  if (events.length === 0) return;
  try {
    await post("/worker/run-events", { runId, events });
  } catch {
    /* the live feed is best-effort; the run itself carries on */
  }
}
