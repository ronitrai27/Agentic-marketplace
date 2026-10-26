import { awaitWorkflow, WorkflowRunError, type WorkflowSnapshot } from "./temporal/await-workflow.js";

// Fake Temporal handle: no server needed. `describe` + `result` + cancel/terminate are all we use.
function fakeHandle(opts: {
  statusAt: (n: number) => string;
  result?: () => Promise<unknown>;
  pendingTaskAttempt?: number;
}) {
  let describes = 0;
  const calls = { cancel: 0, terminate: 0 };
  const handle: any = {
    result: opts.result ?? (() => new Promise(() => {})), // never resolves by default
    describe: async () => {
      describes++;
      return {
        status: { name: opts.statusAt(describes) },
        historyLength: 4,
        raw: {
          pendingWorkflowTask: opts.pendingTaskAttempt ? { attempt: opts.pendingTaskAttempt } : undefined,
          pendingActivities: [
            { activityType: { name: "staticCrawlActivity" }, attempt: 2, lastFailure: { message: "boom", cause: { message: "ECONNRESET" } } },
          ],
        },
      };
    },
    cancel: async () => void calls.cancel++,
    terminate: async () => void calls.terminate++,
  };
  return { handle, calls };
}

let failed = 0;
function check(ok: boolean, label: string) {
  console.log(`${ok ? "✅" : "❌"} ${label}`);
  if (!ok) failed++;
}

async function expectError(promise: Promise<unknown>): Promise<WorkflowRunError | undefined> {
  try {
    await promise;
  } catch (err) {
    return err as WorkflowRunError;
  }
  return undefined;
}

async function main() {
  // 1. Terminated while running: must fail fast, even though result() never settles
  {
    const { handle } = fakeHandle({ statusAt: (n) => (n < 2 ? "RUNNING" : "TERMINATED") });
    const t0 = Date.now();
    const err = await expectError(awaitWorkflow(handle, { pollMs: 20 }));
    check(err?.code === "WORKFLOW_TERMINATED", "terminated -> WORKFLOW_TERMINATED");
    check(err?.retryable === true, "terminated is retryable");
    check(Date.now() - t0 < 5000, "terminated detected without waiting for result()");
  }

  // 2. Cancelled in Temporal
  {
    const { handle } = fakeHandle({ statusAt: (n) => (n < 2 ? "RUNNING" : "CANCELLED") });
    const err = await expectError(awaitWorkflow(handle, { pollMs: 20 }));
    check(err?.code === "TASK_CANCELED", "cancelled -> TASK_CANCELED");
  }

  // 3. Timed out by Temporal
  {
    const { handle } = fakeHandle({ statusAt: (n) => (n < 2 ? "RUNNING" : "TIMED_OUT") });
    const err = await expectError(awaitWorkflow(handle, { pollMs: 20 }));
    check(err?.code === "EXECUTION_TIMEOUT", "timed out -> EXECUTION_TIMEOUT");
  }

  // 4. result() rejects with a nested activity failure: root cause message must surface
  {
    const failure = Object.assign(new Error("Workflow execution failed"), {
      cause: Object.assign(new Error("Activity task failed"), { cause: new Error("Firecrawl 402: out of credits") }),
    });
    const { handle } = fakeHandle({ statusAt: () => "FAILED", result: () => Promise.reject(failure) });
    const err = await expectError(awaitWorkflow(handle, { pollMs: 20 }));
    check(err?.code === "TOOL_FAILURE" && err.message.includes("Firecrawl 402"), "failure carries root-cause message");
  }

  // 5. Worker never completes the workflow task -> terminate + WORKER_UNRESPONSIVE
  {
    const { handle, calls } = fakeHandle({ statusAt: () => "RUNNING", pendingTaskAttempt: 3 });
    const err = await expectError(awaitWorkflow(handle, { pollMs: 20 }));
    check(err?.code === "WORKER_UNRESPONSIVE", "stuck workflow task -> WORKER_UNRESPONSIVE");
    check(calls.terminate === 1, "stuck workflow is terminated (no double run)");
  }

  // 6. Abort signal cancels the workflow
  {
    const ac = new AbortController();
    const { handle, calls } = fakeHandle({ statusAt: () => "RUNNING" });
    setTimeout(() => ac.abort(), 30);
    const err = await expectError(awaitWorkflow(handle, { pollMs: 1000, signal: ac.signal }));
    check(err?.code === "TASK_CANCELED" && calls.cancel === 1, "abort -> workflow cancel + TASK_CANCELED");
  }

  // 7. Happy path + snapshots reported
  {
    const snaps: WorkflowSnapshot[] = [];
    const { handle } = fakeHandle({
      statusAt: () => "RUNNING",
      result: () => new Promise((r) => setTimeout(() => r({ ok: 1 }), 80)),
    });
    const value = await awaitWorkflow<{ ok: number }>(handle, { pollMs: 20, onSnapshot: (s) => snaps.push(s) });
    check(value.ok === 1, "returns the workflow result");
    check(snaps.length > 0 && snaps[0]!.status === "RUNNING", "onSnapshot reports real status");
    check(snaps[0]!.pendingActivities[0]?.lastError === "ECONNRESET", "activity retry root error exposed");
  }

  console.log(failed === 0 ? "\n🎉 awaitWorkflow tests passed" : `\n⚠️ ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main();
