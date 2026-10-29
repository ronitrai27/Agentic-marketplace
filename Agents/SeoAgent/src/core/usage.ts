import type { AgentUsage } from "catelog";

export interface UsageEntry {
  model: string;
  prompt: number;
  completion: number;
  costUsd?: number;
}

/**
 * Collects token usage across every model call of one run (JEV + OpenAI) and forwards it to
 * Catelog's `ctx.usage`, which builds `telemetry.models`. No price table here: `costUsd` is
 * recorded only when the provider returned it; otherwise the marketplace prices the tokens.
 */
export class UsageTracker {
  private entries: UsageEntry[] = [];

  constructor(private readonly sink?: AgentUsage) {}

  /** Record a call. Pass `costUsd` only if the provider reported it. */
  add(model: string, prompt = 0, completion = 0, costUsd?: number): void {
    this.entries.push({ model, prompt, completion, costUsd });
    this.sink?.record({ model, tokens: { prompt, completion }, costUsd });
  }

  /** Record a LangChain AIMessage's usage_metadata. */
  addLangChain(
    model: string,
    res: {
      usage_metadata?: { input_tokens?: number; output_tokens?: number };
      response_metadata?: { model_name?: string; model?: string };
    },
  ): void {
    // Prefer the model the provider reports it actually used over the one we asked for
    const actual = res.response_metadata?.model_name ?? res.response_metadata?.model;
    this.add(actual || model, res.usage_metadata?.input_tokens ?? 0, res.usage_metadata?.output_tokens ?? 0);
  }

  /** Record an OpenRouter-style `usage` object, if the response has one. */
  addProviderUsage(model: string, usage: any): void {
    if (!usage || typeof usage !== "object") return;
    this.add(
      model,
      Number(usage.prompt_tokens ?? usage.input_tokens ?? 0),
      Number(usage.completion_tokens ?? usage.output_tokens ?? 0),
      typeof usage.cost === "number" ? usage.cost : undefined,
    );
  }

  /** Extra per-call detail. Models, tokens and cost are built by the SDK from `ctx.usage`. */
  telemetry() {
    return { framework: { model_calls: this.entries } };
  }
}
