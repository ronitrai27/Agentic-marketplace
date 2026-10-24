import { task, logger } from "@trigger.dev/sdk";
import { runResearchAgent } from "../index.js";

export interface DeepResearchPayload {
  prompt: string;
  userId?: string;
  sessionId?: string;
  runId?: string;
  callbackUrl?: string;
}

/**
 * Trigger.dev Long-Running Background Task: Deep Research Agent
 * Handles 4-7+ minute research workflows with resilient retries and automatic timeout protection.
 */
export const deepResearchTask = task({
  id: "deep-research-agent",
  maxDuration: 600, // 10 minutes maximum duration
  retry: {
    maxAttempts: 3,
    factor: 2,
    minTimeoutInMs: 1000,
    maxTimeoutInMs: 10000,
    randomize: true,
  },
  run: async (payload: DeepResearchPayload) => {
    logger.info("Starting background deep research task", {
      prompt: payload.prompt,
      userId: payload.userId,
      runId: payload.runId,
    });

    const result = await runResearchAgent(payload.prompt, {
      userId: payload.userId,
      sessionId: payload.sessionId,
      onProgress: (step: string) => {
        logger.info(`[Research Progress] ${step}`);
      },
    });

    logger.info("Deep research task finished", {
      status: result.status,
      durationSeconds: result.durationSeconds,
      sourcesCount: result.sourcesCount,
    });

    // Notify the Agent server webhook if callbackUrl is provided
    if (payload.callbackUrl) {
      try {
        logger.info(`Sending callback notification to: ${payload.callbackUrl}`);
        await fetch(payload.callbackUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            runId: payload.runId,
            result,
          }),
        });
      } catch (err: any) {
        logger.error("Failed to notify callback endpoint", { error: err?.message });
      }
    }

    return result;
  },
});
