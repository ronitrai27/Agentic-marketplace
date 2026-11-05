import type { WorkflowHandle } from "@temporalio/client";

// ─────────────────────────────────────────────────────────────────────────────
// Watches a Temporal workflow instead of blindly awaiting handle.result().
//
// Why: a bare `await handle.result()` only tells you the outcome at the very end.
// If the workflow is terminated, cancelled, timed out, or its worker never picks
// the task up, the caller either learns late or keeps showing "RUNNING" forever.
// Here we describe() the workflow every few seconds, report what it is really
// doing, and fail fast with a precise, user-readable error.
// ─────────────────────────────────────────────────────────────────────────────

/** Error with a protocol-level `code` that the Catelog SDK forwards to the buyer. */
export class WorkflowRunError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly retryable = false,
  ) {
    super(message);
    this.name = "WorkflowRunError";
  }
}

export interface WorkflowSnapshot {
  /** Real Temporal status: RUNNING, COMPLETED, FAILED, CANCELLED, TERMINATED, TIMED_OUT ... */
  status: string;
  historyLength: number;
  elapsedSeconds: number;
  /** Activities currently running or retrying. */
  pendingActivities: Array<{ name: string; attempt: number; lastError?: string }>;
  /** Attempt number of the pending workflow task (>1 means the worker is not answering). */
  workflowTaskAttempt: number;
}

export interface AwaitWorkflowOptions {
  /** Called on every poll with what the workflow is really doing. */
  onSnapshot?: (snapshot: WorkflowSnapshot) => void;
  /** Aborting cancels the workflow (best effort) and rejects. */
  signal?: AbortSignal;
  /** How often to check the workflow (default 5s). */
  pollMs?: number;
  /**
   * Give up if the worker keeps failing to complete the workflow task this many times in a row
   * (default 3). The workflow is terminated so it can't run twice.
   */
  maxWorkflowTaskAttempts?: number;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function num(value: unknown): number {
  if (typeof value === "number") return value;
  if (value && typeof (value as { toNumber?: () => number }).toNumber === "function") {
    return (value as { toNumber: () => number }).toNumber();
  }
  return Number(value ?? 0) || 0;
}

/** Digs the human message out of Temporal's nested failure chain (WorkflowFailed → ActivityFailure → ApplicationFailure...). */
export function rootCauseMessage(err: unknown): string {
  let current: any = err;
  let message = current?.message ?? String(err);
  let guard = 0;
  while (current?.cause && guard++ < 8) {
    current = current.cause;
    if (current?.message) message = current.message;
  }
  return message;
}

function errorForStatus(status: string, cause?: unknown): WorkflowRunError {
  switch (status) {
    case "TERMINATED":
      return new WorkflowRunError(
        "WORKFLOW_TERMINATED",
        "The audit workflow was terminated in Temporal before it finished.",
        true,
      );
    case "CANCELLED":
    case "CANCELED":
      return new WorkflowRunError("TASK_CANCELED", "The audit workflow was cancelled.", false);
    case "TIMED_OUT":
      return new WorkflowRunError(
        "EXECUTION_TIMEOUT",
        "The audit workflow exceeded its maximum run time and was timed out by Temporal.",
        true,
      );
    default: {
      const detail = cause ? rootCauseMessage(cause) : `Temporal reported status ${status}`;
      return new WorkflowRunError("TOOL_FAILURE", `Audit workflow failed: ${detail}`, false);
    }
  }
}

function describeFailure(failure: any): string | undefined {
  if (!failure) return undefined;
  let current = failure;
  let message: string | undefined = current.message;
  let guard = 0;
  while (current?.cause && guard++ < 8) {
    current = current.cause;
    if (current?.message) message = current.message;
  }
  return message;
}

async function snapshot(handle: WorkflowHandle<any>, startedAt: number): Promise<WorkflowSnapshot> {
  const desc: any = await handle.describe();
  const raw = desc.raw ?? {};
  const pending: any[] = raw.pendingActivities ?? [];
  return {
    status: String(desc.status?.name ?? "UNKNOWN"),
    historyLength: num(desc.historyLength ?? raw.workflowExecutionInfo?.historyLength),
    elapsedSeconds: Math.floor((Date.now() - startedAt) / 1000),
    pendingActivities: pending.map((a) => ({
      name: String(a.activityType?.name ?? "unknown"),
      attempt: num(a.attempt),
      lastError: describeFailure(a.lastFailure),
    })),
    workflowTaskAttempt: num(raw.pendingWorkflowTask?.attempt),
  };
}

/**
 * Resolves with the workflow result, or rejects with a `WorkflowRunError` the moment the
 * workflow ends badly (terminated / cancelled / timed out / failed) or its worker is unresponsive.
 */
export async function awaitWorkflow<T>(handle: WorkflowHandle<any>, options: AwaitWorkflowOptions = {}): Promise<T> {
  const pollMs = options.pollMs ?? 5_000;
  const maxTaskAttempts = options.maxWorkflowTaskAttempts ?? 3;
  const startedAt = Date.now();

  type Settled = { ok: true; value: T } | { ok: false; error: unknown };
  const resultPromise: Promise<Settled> = (handle.result() as Promise<T>).then(
    (value): Settled => ({ ok: true, value }),
    (error: unknown): Settled => ({ ok: false, error }),
  );

  const abortPromise = new Promise<"abort">((resolve) => {
    if (options.signal?.aborted) return resolve("abort");
    options.signal?.addEventListener("abort", () => resolve("abort"), { once: true });
  });

  let consecutiveDescribeErrors = 0;

  for (;;) {
    const winner = await Promise.race([resultPromise, abortPromise, sleep(pollMs).then(() => "tick" as const)]);

    if (winner === "abort") {
      await handle.cancel().catch(() => undefined);
      throw new WorkflowRunError("TASK_CANCELED", "The audit was cancelled before it finished.", false);
    }

    if (winner !== "tick") {
      if (winner.ok) return winner.value;
      // result() rejected: ask Temporal for the authoritative final status
      const final = await snapshot(handle, startedAt).catch(() => undefined);
      throw errorForStatus(final?.status ?? "FAILED", winner.error);
    }

    let snap: WorkflowSnapshot;
    try {
      snap = await snapshot(handle, startedAt);
      consecutiveDescribeErrors = 0;
    } catch (err) {
      // Temporal itself unreachable: tolerate blips, fail if it persists (~30s)
      if (++consecutiveDescribeErrors >= 6) {
        throw new WorkflowRunError(
          "TEMPORAL_UNAVAILABLE",
          `Lost contact with Temporal while the audit was running: ${rootCauseMessage(err)}`,
          true,
        );
      }
      continue;
    }

    options.onSnapshot?.(snap);

    if (snap.status !== "RUNNING") {
      // Closed. Prefer the real failure message from result() if it arrives promptly.
      const settled = await Promise.race([resultPromise, sleep(2_000).then(() => undefined)]);
      if (settled?.ok) return settled.value;
      throw errorForStatus(snap.status, settled && !settled.ok ? settled.error : undefined);
    }

    if (snap.workflowTaskAttempt >= maxTaskAttempts) {
      await handle.terminate("Worker did not complete the workflow task; giving up").catch(() => undefined);
      throw new WorkflowRunError(
        "WORKER_UNRESPONSIVE",
        `The Temporal worker received the audit but did not complete it after ${snap.workflowTaskAttempt} attempts. ` +
          "The worker is likely overloaded or crashing; check its logs.",
        true,
      );
    }

  }
}
