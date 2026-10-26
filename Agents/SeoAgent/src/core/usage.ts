/** Per-million-token USD prices for models this agent calls. */
const PRICING_PER_MTOK: Record<string, { in: number; out: number }> = {
  "gpt-4.1-mini": { in: 0.4, out: 1.6 },
  "gpt-4o-mini": { in: 0.15, out: 0.6 },
};

export interface UsageEntry {
  model: string;
  prompt: number;
  completion: number;
  costUsd: number;
}

/** Collects token usage / cost across every model call of one run (JEV + OpenAI) for Catelog telemetry. */
export class UsageTracker {
  private entries: UsageEntry[] = [];

  /** Record a call. `costUsd` overrides the price table (e.g. when the provider reports cost itself). */
  add(model: string, prompt = 0, completion = 0, costUsd?: number): void {
    const price = PRICING_PER_MTOK[model];
    const cost = costUsd ?? (price ? (prompt * price.in + completion * price.out) / 1_000_000 : 0);
    this.entries.push({ model, prompt, completion, costUsd: cost });
  }

  /** Record a LangChain AIMessage's usage_metadata. */
  addLangChain(model: string, res: { usage_metadata?: { input_tokens?: number; output_tokens?: number } }): void {
    this.add(model, res.usage_metadata?.input_tokens ?? 0, res.usage_metadata?.output_tokens ?? 0);
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

  telemetry() {
    const prompt = this.entries.reduce((s, e) => s + e.prompt, 0);
    const completion = this.entries.reduce((s, e) => s + e.completion, 0);
    const cost = this.entries.reduce((s, e) => s + e.costUsd, 0);
    const models = [...new Set(this.entries.map((e) => e.model))];
    return {
      model_used: models.join(", ") || undefined,
      llm_tokens: { prompt, completion, total: prompt + completion },
      cost_usd: Number(cost.toFixed(6)),
      framework: { model_calls: this.entries },
    };
  }
}
