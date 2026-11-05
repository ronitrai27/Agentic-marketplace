import { Context } from "@temporalio/activity";
import { runDeepResearch, type AgentExecutionResult } from "../index.js";
import { progressEmitter } from "../observability/progress.js";
import type { ResearchWorkflowInput } from "./types.js";

/**
 * Temporal Activity: Executes the multi-node LangGraph Deep Research engine.
 * Emits periodic heartbeats to Temporal cluster to signal activity liveness and current step progress.
 */
export async function runDeepResearchActivity(
  input: ResearchWorkflowInput
): Promise<AgentExecutionResult> {
  const actInfo = Context.current().info;
  console.log(`\n======================================================`);
  console.log(`[Temporal Activity: runDeepResearchActivity]`);
  console.log(`   - Activity ID: ${actInfo.activityId}`);
  console.log(`   - Attempt: ${actInfo.attempt}`);
  console.log(`   - Prompt: "${input.prompt}"`);
  console.log(`======================================================\n`);

  Context.current().heartbeat("Initializing LangGraph deep research workflow");

  const progressHandler = ({ step }: { step: string }) => {
    try {
      Context.current().heartbeat({
        step,
        attempt: actInfo.attempt,
        timestamp: Date.now(),
      });
    } catch {}
  };
  progressEmitter.on("step", progressHandler);

  let result: AgentExecutionResult;
  try {
    result = await runDeepResearch(input.prompt, {
      userId: input.userId,
      sessionId: input.sessionId,
      runId: input.runId,
      onProgress: (step: string) => {
        console.log(`   ⏳ [Temporal Heartbeat & Progress]: ${step}`);
      },
    });
  } finally {
    progressEmitter.off("step", progressHandler);
  }

  console.log(`\n======================================================`);
  console.log(`[Temporal Activity: Complete]`);
  console.log(`   - Status: ${result.status}`);
  console.log(`   - Sources Referenced: ${result.sourcesCount}`);
  console.log(`   - Latency: ${result.durationSeconds}s`);
  console.log(`======================================================\n`);

  return result;
}
