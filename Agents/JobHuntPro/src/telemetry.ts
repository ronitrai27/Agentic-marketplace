import type { Reporter } from "./events.js";

/**
 * Telemetry adapter for the Vercel AI SDK. Call after every generateObject/generateText with
 * its result; it reports model id + token counts + latency to Catelog (`ctx.usage.record`).
 * Cost is intentionally NOT estimated: Catelog only reports cost a provider actually returned.
 */
export function recordUsage(
  rep: Reporter,
  provider: "anthropic" | "openai",
  res: { usage?: any; response?: { modelId?: string } },
  fallbackModel: string,
  startedAt: number,
) {
  try {
    const u = res.usage ?? {};
    const prompt = u.inputTokens ?? 0;
    const completion = u.outputTokens ?? 0;
    rep.usage({
      model: res.response?.modelId || fallbackModel,
      provider,
      tokens: {
        prompt,
        completion,
        total: u.totalTokens ?? prompt + completion,
        cached: u.inputTokenDetails?.cacheReadTokens ?? undefined,
        reasoning: u.outputTokenDetails?.reasoningTokens ?? undefined,
      },
      latencyMs: Date.now() - startedAt,
    });
  } catch {
    /* telemetry must never break a run */
  }
}
