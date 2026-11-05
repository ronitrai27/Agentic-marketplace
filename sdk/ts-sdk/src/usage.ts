/**
 * Usage capture: which models a run used, how many tokens, and (only if reported) real cost.
 *
 * Sources, all feeding one per-run `UsageTracker`:
 *  1. Framework adapters (`pipe*Stream`)            → via telemetry returned by the adapter
 *  2. OpenTelemetry spans (`catelogSpanProcessor`)  → Vercel AI SDK, OpenLLMetry, any `gen_ai.*` span
 *  3. LangChain / LangGraph callbacks               → `createLangChainUsageHandler(ctx.usage)`
 *  4. Custom code                                   → `ctx.usage.record({ model, tokens })`
 *
 * Rules: the SDK NEVER estimates cost from a price list, and NOTHING here may throw into
 * the agent. Bad or missing data is skipped silently.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import type {
  AgentUsage,
  CostSource,
  ModelUsage,
  TelemetryData,
  TokenUsage,
  UsageRecord,
} from "./types.js";

const MAX_MODELS_PER_RUN = 50;

// ─────────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────────

function num(v: unknown): number | undefined {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) && n >= 0 ? n : undefined;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() !== "" ? v.trim() : undefined;
}

function cleanTokens(t: TokenUsage | undefined): TokenUsage {
  const out: TokenUsage = {};
  if (!t || typeof t !== "object") return out;
  for (const key of ["prompt", "completion", "total", "cached", "reasoning"] as const) {
    const n = num(t[key]);
    if (n !== undefined) out[key] = n;
  }
  if (out.total === undefined && (out.prompt !== undefined || out.completion !== undefined)) {
    out.total = (out.prompt ?? 0) + (out.completion ?? 0);
  }
  return out;
}

// ─────────────────────────────────────────────────
//  Per-run tracker
// ─────────────────────────────────────────────────

interface Entry {
  usage: ModelUsage;
  /** Calls that reported a cost. Cost is only exposed when this equals the number of calls. */
  costedCalls: number;
  totalCalls: number;
  costSources: Set<CostSource>;
}

export class UsageTracker {
  private readonly entries = new Map<string, Entry>();

  /** Never throws. */
  record(rec: UsageRecord, costSource: CostSource = "agent"): void {
    try {
      const id = str(rec?.model);
      if (!id) return;
      const provider = str(rec.provider);
      const key = `${provider ?? ""}\u0000${id}`;

      let entry = this.entries.get(key);
      if (!entry) {
        if (this.entries.size >= MAX_MODELS_PER_RUN) return;
        entry = { usage: { id, provider, tokens: {} }, costedCalls: 0, totalCalls: 0, costSources: new Set() };
        this.entries.set(key, entry);
      }

      const calls = Math.max(1, Math.floor(num(rec.calls) ?? 1));
      entry.totalCalls += calls;
      entry.usage.calls = entry.totalCalls;

      const tokens = cleanTokens(rec.tokens);
      for (const k of Object.keys(tokens) as Array<keyof TokenUsage>) {
        entry.usage.tokens[k] = (entry.usage.tokens[k] ?? 0) + (tokens[k] as number);
      }

      const cost = num(rec.costUsd);
      if (cost !== undefined) {
        entry.costedCalls += calls;
        entry.usage.cost_usd = (entry.usage.cost_usd ?? 0) + cost;
        entry.costSources.add(costSource);
      }

      const latency = num(rec.latencyMs);
      if (latency !== undefined) entry.usage.latency_ms = (entry.usage.latency_ms ?? 0) + latency;
    } catch {
      /* usage capture must never affect the run */
    }
  }

  get isEmpty(): boolean {
    return this.entries.size === 0;
  }

  snapshot(): ModelUsage[] {
    const out: ModelUsage[] = [];
    for (const e of this.entries.values()) {
      const u: ModelUsage = { ...e.usage, tokens: { ...e.usage.tokens } };
      if (e.costedCalls < e.totalCalls) {
        // Partial cost would understate spend; leave it for the marketplace to price from tokens.
        delete u.cost_usd;
      } else if (u.cost_usd !== undefined) {
        u.cost_usd = round6(u.cost_usd);
        u.cost_source = e.costSources.has("agent") ? "agent" : "provider";
      }
      out.push(u);
    }
    return out;
  }

  /** The `ctx.usage` facade handed to agent code. */
  facade(): AgentUsage {
    return { record: (usage) => this.record(usage, "agent") };
  }
}

const round6 = (n: number) => parseFloat(n.toFixed(6));

// ─────────────────────────────────────────────────
//  Merging into telemetry
// ─────────────────────────────────────────────────

/** Totals derived from a per-model breakdown. */
export function summarizeModels(models: ModelUsage[]): Pick<TelemetryData, "llm_tokens" | "model_used" | "cost_usd" | "cost_source"> {
  const llm_tokens: TokenUsage = {};
  for (const m of models) {
    for (const k of Object.keys(m.tokens) as Array<keyof TokenUsage>) {
      llm_tokens[k] = (llm_tokens[k] ?? 0) + (m.tokens[k] ?? 0);
    }
  }
  const out: ReturnType<typeof summarizeModels> = {
    llm_tokens,
    model_used: models.map((m) => m.id).join(",") || undefined,
  };
  if (models.length > 0 && models.every((m) => m.cost_usd !== undefined)) {
    out.cost_usd = round6(models.reduce((n, m) => n + (m.cost_usd ?? 0), 0));
    out.cost_source = models.some((m) => m.cost_source === "agent") ? "agent" : "provider";
  }
  return out;
}

/**
 * Decides the final model/token/cost fields of a run's telemetry.
 * Priority: tracker (spans / callbacks / ctx.usage) > adapter `models` > adapter flat fields.
 * Sources are never added together, so using an adapter AND OpenTelemetry cannot double count.
 */
export function resolveUsageTelemetry(
  adapter: Partial<TelemetryData> | undefined,
  tracker: UsageTracker | undefined,
): Partial<TelemetryData> {
  try {
    if (tracker && !tracker.isEmpty) {
      const models = tracker.snapshot();
      return { models, ...summarizeModels(models) };
    }
    if (adapter?.models?.length) {
      return { models: adapter.models, ...summarizeModels(adapter.models), ...pickCost(adapter) };
    }
    if (adapter?.model_used || adapter?.llm_tokens) {
      const ids = (adapter.model_used ?? "").split(",").map((s) => s.trim()).filter(Boolean);
      // Tokens can only be attributed when a single model is named
      if (ids.length <= 1) {
        const model: ModelUsage = { id: ids[0] ?? "unknown", tokens: cleanTokens(adapter.llm_tokens) };
        if (num(adapter.cost_usd) !== undefined) {
          model.cost_usd = adapter.cost_usd;
          model.cost_source = adapter.cost_source ?? "provider";
        }
        return { models: [model] };
      }
      return { models: ids.map((id) => ({ id, tokens: {} })) };
    }
  } catch {
    /* fall through: no usage data */
  }
  return {};
}

function pickCost(t: Partial<TelemetryData>): Partial<TelemetryData> {
  // Adapters (e.g. Claude Agent SDK) may know a more exact total than the per-model sum
  if (num(t.cost_usd) === undefined) return {};
  return { cost_usd: t.cost_usd, cost_source: t.cost_source ?? "provider" };
}

// ─────────────────────────────────────────────────
//  Run scoping (so global OpenTelemetry spans reach the right run)
// ─────────────────────────────────────────────────

const runScope = new AsyncLocalStorage<UsageTracker>();
const trackerByContext = new WeakMap<object, UsageTracker>();

/** @internal */
export function bindTracker(ctx: object, tracker: UsageTracker): void {
  trackerByContext.set(ctx, tracker);
}

/** @internal Runs `fn` so spans created inside it are attributed to this run's tracker. */
export function runWithTracker<T>(ctx: object, fn: () => T): T {
  const tracker = trackerByContext.get(ctx);
  return tracker ? runScope.run(tracker, fn) : fn();
}

// ─────────────────────────────────────────────────
//  OpenTelemetry span processor (no @opentelemetry dependency)
// ─────────────────────────────────────────────────

type Attrs = Record<string, unknown>;

/** `gen_ai.operation.name` values that are one real model call (agent/tool spans are skipped to avoid double counting). */
const LLM_OPERATIONS = new Set(["chat", "text_completion", "generate_content", "completion", "embeddings", "embed"]);

/** Turns the attributes of one finished span into a usage record, or `undefined` if it is not an LLM call. */
export function usageFromSpan(name: string | undefined, attrs: Attrs | undefined): UsageRecord | undefined {
  try {
    if (!attrs) return undefined;
    const operation = str(attrs["gen_ai.operation.name"]);
    const hasGenAi = Object.keys(attrs).some((k) => k.startsWith("gen_ai.request.model") || k.startsWith("gen_ai.usage."));
    // Vercel AI SDK: the inner `ai.*.doGenerate` / `doStream` span is the real call; outer `ai.generateText` spans repeat it.
    const isVercelCall = typeof name === "string" && /\.(doGenerate|doStream|doEmbed)$/.test(name);
    if (!hasGenAi && !isVercelCall) return undefined;
    if (operation && !LLM_OPERATIONS.has(operation)) return undefined;

    const model = str(attrs["gen_ai.response.model"]) ?? str(attrs["gen_ai.request.model"]) ?? str(attrs["ai.response.model"]) ?? str(attrs["ai.model.id"]);
    if (!model) return undefined;

    const provider =
      str(attrs["gen_ai.provider.name"]) ??
      str(attrs["gen_ai.system"]) ??
      str(attrs["ai.model.provider"])?.split(".")[0];

    const pick = (...keys: string[]) => {
      for (const k of keys) {
        const n = num(attrs[k]);
        if (n !== undefined) return n;
      }
      return undefined;
    };
    const tokens = cleanTokens({
      prompt: pick("gen_ai.usage.input_tokens", "gen_ai.usage.prompt_tokens", "ai.usage.inputTokens", "ai.usage.promptTokens"),
      completion: pick("gen_ai.usage.output_tokens", "gen_ai.usage.completion_tokens", "ai.usage.outputTokens", "ai.usage.completionTokens"),
      cached: pick("gen_ai.usage.cache_read.input_tokens", "gen_ai.usage.cached_tokens", "ai.usage.cachedInputTokens"),
      reasoning: pick("gen_ai.usage.reasoning_tokens", "ai.usage.reasoningTokens"),
    });

    return {
      model,
      provider,
      tokens,
      // Only real, provider-reported cost; some gateways (OpenRouter) put it in providerMetadata
      costUsd: pick("gen_ai.usage.cost") ?? costFromProviderMetadata(attrs["ai.response.providerMetadata"]),
    };
  } catch {
    return undefined;
  }
}

function costFromProviderMetadata(raw: unknown): number | undefined {
  try {
    const meta = typeof raw === "string" ? JSON.parse(raw) : raw;
    return num((meta as any)?.openrouter?.usage?.cost);
  } catch {
    return undefined;
  }
}

function hrToMs(t: unknown): number | undefined {
  return Array.isArray(t) && t.length === 2 && typeof t[0] === "number" && typeof t[1] === "number"
    ? t[0] * 1000 + t[1] / 1e6
    : undefined;
}

/**
 * Drop-in OpenTelemetry `SpanProcessor`. Add it once and every `gen_ai.*` LLM span created
 * during a run is attributed to that run's `telemetry.models`.
 *
 * @example
 * ```ts
 * import { NodeSDK } from "@opentelemetry/sdk-node";
 * import { catelogSpanProcessor } from "catelog";
 *
 * new NodeSDK({ spanProcessors: [catelogSpanProcessor] }).start();
 * // Vercel AI SDK: generateText({ ..., experimental_telemetry: { isEnabled: true } })
 * ```
 */
export const catelogSpanProcessor = (() => {
  const pending = new Map<string, UsageTracker>();
  const spanId = (span: any): string | undefined => {
    try {
      return span?.spanContext?.().spanId;
    } catch {
      return undefined;
    }
  };

  return {
    onStart(span: any): void {
      try {
        const tracker = runScope.getStore();
        const id = spanId(span);
        if (tracker && id) pending.set(id, tracker);
      } catch {
        /* ignore */
      }
    },
    onEnd(span: any): void {
      try {
        const id = spanId(span);
        const tracker = (id && pending.get(id)) || runScope.getStore();
        if (id) pending.delete(id);
        if (!tracker) return;
        const rec = usageFromSpan(span?.name, span?.attributes);
        if (rec) tracker.record({ ...rec, latencyMs: hrToMs(span?.duration) }, "provider");
      } catch {
        /* ignore */
      }
    },
    forceFlush: async (): Promise<void> => {},
    shutdown: async (): Promise<void> => {
      pending.clear();
    },
  };
})();

// ─────────────────────────────────────────────────
//  LangChain / LangGraph callback handler (no @langchain dependency)
// ─────────────────────────────────────────────────

/**
 * Callback handler that reports every LLM call of a LangChain / LangGraph run.
 *
 * @example
 * ```ts
 * await graph.invoke(input, { callbacks: [createLangChainUsageHandler(ctx.usage)] });
 * ```
 */
export function createLangChainUsageHandler(usage: AgentUsage) {
  const started = new Map<string, { model?: string; provider?: string; t0: number }>();

  const onStart = (llm: any, _p: unknown, runId: string, _parent?: string, extra?: any, _tags?: string[], metadata?: any) => {
    try {
      started.set(runId, {
        model:
          str(extra?.invocation_params?.model) ??
          str(extra?.invocation_params?.model_name) ??
          str(metadata?.ls_model_name) ??
          str(llm?.kwargs?.model) ??
          str(llm?.kwargs?.model_name),
        provider: str(metadata?.ls_provider),
        t0: Date.now(),
      });
    } catch {
      /* ignore */
    }
  };

  return {
    name: "catelog-usage",
    handleLLMStart: onStart,
    handleChatModelStart: onStart,
    handleLLMEnd(output: any, runId: string): void {
      try {
        const info = started.get(runId);
        started.delete(runId);

        const messages = ((output?.generations ?? []) as any[][]).flat().map((g) => g?.message).filter(Boolean);
        const sum = (f: (m: any) => unknown) => messages.reduce((n, m) => n + (num(f(m)) ?? 0), 0);
        const legacy = output?.llmOutput?.tokenUsage ?? output?.llmOutput?.estimatedTokenUsage;

        const prompt = num(legacy?.promptTokens) ?? (messages.length ? sum((m) => m.usage_metadata?.input_tokens) : undefined);
        const completion = num(legacy?.completionTokens) ?? (messages.length ? sum((m) => m.usage_metadata?.output_tokens) : undefined);
        const model =
          info?.model ??
          str(messages.find((m) => str(m.response_metadata?.model_name ?? m.response_metadata?.model))?.response_metadata?.model_name) ??
          str(output?.llmOutput?.model_name ?? output?.llmOutput?.model);
        if (!model) return;

        usage.record({
          model: str(messages[0]?.response_metadata?.model_name) ?? model,
          provider: info?.provider,
          tokens: {
            prompt,
            completion,
            cached: sum((m) => m.usage_metadata?.input_token_details?.cache_read) || undefined,
            reasoning: sum((m) => m.usage_metadata?.output_token_details?.reasoning) || undefined,
          },
          latencyMs: info ? Date.now() - info.t0 : undefined,
        });
      } catch {
        /* ignore */
      }
    },
    handleLLMError(_err: unknown, runId: string): void {
      started.delete(runId);
    },
  };
}
