import {
  proxyActivities,
  defineQuery,
  defineSignal,
  setHandler,
  workflowInfo,
} from "@temporalio/workflow";
import type * as activities from "./activities.js";
import type {
  ResearchWorkflowInput,
  WorkflowEvent,
  WorkflowState,
} from "./types.js";
import type { AgentExecutionResult } from "../index.js";

// Queries to inspect workflow status & recorded events at any point
export const getEventsQuery = defineQuery<WorkflowEvent[]>("getEvents");
export const getStateQuery = defineQuery<WorkflowState>("getState");

// Signals to push external updates/events into the workflow history
export const addEventSignal = defineSignal<[WorkflowEvent]>("@recordEvent");

// Proxy activity definition with 10-minute timeout and 3 exponential backoff retries
const { runDeepResearchActivity } = proxyActivities<typeof activities>({
  startToCloseTimeout: "10 minutes",
  heartbeatTimeout: "2 minutes",
  retry: {
    maximumAttempts: 3,
    initialInterval: "2 seconds",
    backoffCoefficient: 2,
    maximumInterval: "30 seconds",
  },
});

/**
 * Temporal Durable Workflow: Deep Research Agent
 * Orchestrates long-running, multi-step deep research with guaranteed durability and event tracking.
 */
export async function deepResearchWorkflow(
  input: ResearchWorkflowInput
): Promise<AgentExecutionResult> {
  const info = workflowInfo();
  const events: WorkflowEvent[] = [];

  const state: WorkflowState = {
    workflowId: info.workflowId,
    runId: input.runId,
    status: "RUNNING",
    progress: "Workflow initialized",
    events,
    startedAt: Date.now(),
  };

  const recordEvent = (type: WorkflowEvent["type"], message: string, details?: any) => {
    const event: WorkflowEvent = {
      timestamp: Date.now(),
      type,
      message,
      details,
    };
    events.push(event);
    state.progress = message;
  };

  // Register Query Handlers
  setHandler(getEventsQuery, () => events);
  setHandler(getStateQuery, () => state);

  // Register Signal Handlers
  setHandler(addEventSignal, (event: WorkflowEvent) => {
    events.push(event);
    state.progress = event.message;
  });

  recordEvent("STARTED", `Started deep research workflow for prompt: "${input.prompt}"`, {
    userId: input.userId,
    runId: input.runId,
  });

  try {
    recordEvent("PROGRESS", "Invoking LangGraph deep research activity...");
    const result = await runDeepResearchActivity(input);

    state.status = "COMPLETED";
    state.completedAt = Date.now();
    recordEvent("COMPLETED", `Deep research completed in ${result.durationSeconds}s`, {
      sourcesCount: result.sourcesCount,
      status: result.status,
    });

    return result;
  } catch (err: any) {
    state.status = "FAILED";
    state.completedAt = Date.now();
    recordEvent("FAILED", `Deep research activity failed: ${err?.message || String(err)}`);
    throw err;
  }
}
