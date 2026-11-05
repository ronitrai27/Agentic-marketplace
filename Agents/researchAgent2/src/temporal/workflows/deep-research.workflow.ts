import { proxyActivities, defineSignal, defineQuery, setHandler } from "@temporalio/workflow";
import type * as activities from "../activities.js";

const { executeDeepResearchActivity } = proxyActivities<typeof activities>({
  startToCloseTimeout: "30 minutes",
  heartbeatTimeout: "60 seconds",
  retry: {
    initialInterval: "5 seconds",
    maximumAttempts: 3,
  },
});

export interface DeepResearchWorkflowInput {
  prompt: string;
}

export interface DeepResearchWorkflowResult {
  answer: string;
  model: string;
  duration_seconds: number;
  taskId: string;
  status: string;
}

// Queries and Signals for real-time progress observation
export const getStatusQuery = defineQuery<{ status: string; progress: string }>("getStatus");

export async function deepResearchWorkflow(
  input: DeepResearchWorkflowInput
): Promise<DeepResearchWorkflowResult> {
  let currentStatus = "STARTING";
  let progressMessage = "Initializing OpenAI deep reasoning model...";

  setHandler(getStatusQuery, () => ({
    status: currentStatus,
    progress: progressMessage,
  }));

  currentStatus = "RUNNING";
  progressMessage = "Running deep reasoning with web search and citations...";

  const result = await executeDeepResearchActivity({
    prompt: input.prompt,
  });

  currentStatus = "COMPLETED";
  progressMessage = "Deep research synthesized successfully.";

  return {
    answer: result.answer,
    model: result.model,
    duration_seconds: result.duration_seconds,
    taskId: result.taskId,
    status: result.status,
  };
}
