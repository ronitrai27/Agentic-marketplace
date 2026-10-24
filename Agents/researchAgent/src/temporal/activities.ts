import { Context } from "@temporalio/activity";
import { runDeepResearch, type AgentExecutionResult } from "../index.js";
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

  const result = await runDeepResearch(input.prompt, {
    userId: input.userId,
    sessionId: input.sessionId,
    runId: input.runId,
    onProgress: (step: string) => {
      console.log(`   ⏳ [Temporal Heartbeat & Progress]: ${step}`);
      // Send heartbeat to Temporal Cluster so stuck executions get detected
      Context.current().heartbeat({
        step,
        attempt: actInfo.attempt,
        timestamp: Date.now(),
      });
    },
  });

  console.log(`\n======================================================`);
  console.log(`[Temporal Activity: Complete]`);
  console.log(`   - Status: ${result.status}`);
  console.log(`   - Sources Referenced: ${result.sourcesCount}`);
  console.log(`   - Latency: ${result.durationSeconds}s`);
  console.log(`======================================================\n`);

  return result;
}
