/**
 * Market prices used ONLY when an agent reports tokens but no real cost.
 * A cost the provider/agent reported always wins; this is a labelled estimate.
 *
 * Prices are USD per 1M tokens. `cacheRead` is optional: when unknown, cached tokens are
 * priced as normal input (a slight overestimate). Unknown models get NO estimate.
 * Update this file when providers change prices; bump PRICES_UPDATED.
 */
export const PRICES_UPDATED = "2026-10";

export interface ModelPrice {
  input: number;
  output: number;
  cacheRead?: number;
}

const PRICES: Record<string, ModelPrice> = {
  // Anthropic
  "claude-fable-5-1": { input: 10, output: 50, cacheRead: 0.25 },
  "claude-fable-5": { input: 10, output: 50, cacheRead: 0.25 },
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2 },
  "claude-opus-5": { input: 5, output: 25 },
  "claude-opus-4-8": { input: 5, output: 25 },
  "claude-opus-4-7": { input: 5, output: 25 },
  "claude-opus-4-6": { input: 5, output: 25 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.2 },
  "claude-sonnet-5": { input: 2, output: 10 },
  "claude-sonnet-4-6": { input: 3, output: 15 },
  "claude-sonnet-4-5": { input: 3, output: 15 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5 },
  "claude-haiku-4-5": { input: 1, output: 5 },
  "claude-3-5-haiku": { input: 0.8, output: 4 },
  // OpenAI
  "gpt-5": { input: 1.25, output: 10, cacheRead: 0.125 },
  "gpt-5-mini": { input: 0.25, output: 2, cacheRead: 0.025 },
  "gpt-5-nano": { input: 0.05, output: 0.4, cacheRead: 0.005 },
  "gpt-4.1": { input: 2, output: 8, cacheRead: 0.5 },
  "gpt-4.1-mini": { input: 0.4, output: 1.6, cacheRead: 0.1 },
  "gpt-4.1-nano": { input: 0.1, output: 0.4, cacheRead: 0.025 },
  "gpt-4o": { input: 2.5, output: 10, cacheRead: 1.25 },
  "gpt-4o-mini": { input: 0.15, output: 0.6, cacheRead: 0.075 },
  o3: { input: 2, output: 8, cacheRead: 0.5 },
  "o4-mini": { input: 1.1, output: 4.4, cacheRead: 0.275 },
};

/** "openai/gpt-4.1-mini-2025-04-14" -> "gpt-4.1-mini". Only provider prefix and date suffix are dropped. */
export function normalizeModelId(id: string): string {
  return id
    .trim()
    .toLowerCase()
    .replace(/^[a-z0-9_.-]+\//, "")
    .replace(/@.*$/, "")
    .replace(/-\d{4}-\d{2}-\d{2}$/, "")
    .replace(/-\d{8}$/, "");
}

const PROVIDER_LABEL: Array<[RegExp, string]> = [
  [/^claude/, "Anthropic"],
  [/^(gpt|o\d|chatgpt)/, "OpenAI"],
  [/^gemini/, "Google"],
  [/^(llama|meta-llama)/, "Meta"],
  [/^mistral|^mixtral/, "Mistral"],
];

/** Display provider for a model id, used when the agent did not report one. */
export function providerOf(modelId: string): string | undefined {
  const id = normalizeModelId(modelId);
  return PROVIDER_LABEL.find(([re]) => re.test(id))?.[1];
}

export function priceFor(modelId: string): ModelPrice | undefined {
  return PRICES[normalizeModelId(modelId)];
}

export interface TokenCounts {
  prompt?: number;
  completion?: number;
  total?: number;
  cached?: number;
}

export function estimateCostUsd(modelId: string, t: TokenCounts): number | undefined {
  const p = priceFor(modelId);
  if (!p) return undefined;
  const prompt = t.prompt ?? 0;
  const cached = Math.min(t.cached ?? 0, prompt);
  const completion = t.completion ?? 0;
  return (
    ((prompt - cached) * p.input + cached * (p.cacheRead ?? p.input) + completion * p.output) /
    1_000_000
  );
}

// ─────────────────────────────────────────────────
//  Reading an agent's telemetry
// ─────────────────────────────────────────────────

export type CostSource = "provider" | "agent" | "estimated";

export interface ModelLine {
  id: string;
  provider?: string;
  tokens: TokenCounts;
  totalTokens: number;
  costUsd?: number;
  costSource?: CostSource;
}

export interface UsageReport {
  /** True only if at least one model with a name AND tokens was reported. Gate for dry-run Step 2. */
  ok: boolean;
  models: ModelLine[];
  /** Sum of every model's cost; undefined when any model has no price (so it never understates). */
  totalCostUsd?: number;
  /** True when part of the cost is a market-price estimate rather than a reported figure. */
  estimated: boolean;
}

const num = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : undefined;

export function analyzeUsage(telemetry: unknown): UsageReport {
  const t = (telemetry ?? {}) as Record<string, any>;
  let raw: any[] = Array.isArray(t.models) ? t.models : [];

  // Older SDKs (<1.2) only send flat model_used + llm_tokens
  if (raw.length === 0 && typeof t.model_used === "string" && t.model_used && t.llm_tokens) {
    const ids = t.model_used.split(",").map((s: string) => s.trim()).filter(Boolean);
    if (ids.length === 1) raw = [{ id: ids[0], tokens: t.llm_tokens, cost_usd: t.cost_usd, cost_source: t.cost_source }];
  }

  const models: ModelLine[] = [];
  for (const m of raw) {
    const id = typeof m?.id === "string" ? m.id.trim() : "";
    if (!id) continue;
    const tk = (m.tokens ?? {}) as TokenCounts;
    const totalTokens = num(tk.total) ?? (num(tk.prompt) ?? 0) + (num(tk.completion) ?? 0);
    const line: ModelLine = { id, provider: typeof m.provider === "string" ? m.provider : undefined, tokens: tk, totalTokens };
    const reported = num(m.cost_usd);
    if (reported !== undefined) {
      line.costUsd = reported;
      line.costSource = m.cost_source === "agent" ? "agent" : "provider";
    } else {
      const est = estimateCostUsd(id, tk);
      if (est !== undefined) {
        line.costUsd = est;
        line.costSource = "estimated";
      }
    }
    models.push(line);
  }

  const ok = models.some((m) => m.totalTokens > 0);
  const allPriced = models.length > 0 && models.every((m) => m.costUsd !== undefined);
  return {
    ok,
    models,
    totalCostUsd: allPriced ? models.reduce((n, m) => n + (m.costUsd ?? 0), 0) : undefined,
    estimated: models.some((m) => m.costSource === "estimated"),
  };
}
