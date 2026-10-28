/**
 * Framework Adapters
 *
 * Translates framework-specific streaming patterns into the Catelog
 * task lifecycle contract. Each adapter is a thin transformer that:
 *
 * 1. Pipes framework chunks → stream.delta() / stream.progress()
 * 2. Extracts telemetry (tokens, tool calls) when available
 * 3. Returns the final result in Catelog's { output, telemetry } format
 *
 * All adapters are framework-optional — if the framework library
 * isn't installed, the adapter gracefully skips enrichment.
 */

import type {
  AgentExecutionResult,
  AgentStream,
  AgentUsage,
  ModelUsage,
  TelemetryData,
} from "./types.js";
import { createLangChainUsageHandler } from "./usage.js";

/** Awaits a value that may be a Promise (Vercel `streamText` exposes usage lazily); never throws. */
async function settle<T>(v: T | Promise<T> | undefined): Promise<T | undefined> {
  try {
    return await v;
  } catch {
    return undefined;
  }
}

const numOrUndef = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : undefined;

// ─────────────────────────────────────────────────
//  Vercel AI SDK Adapter
// ─────────────────────────────────────────────────

/**
 * Pipes a Vercel AI SDK streamText/generateText result into Catelog events.
 *
 * @example
 * ```ts
 * import { streamText } from "ai";
 * import { openai } from "@ai-sdk/openai";
 *
 * async execute({ input, stream }) {
 *   const result = streamText({
 *     model: openai("gpt-4o"),
 *     prompt: input.prompt,
 *   });
 *   return pipeAiSdkStream(result, stream);
 * }
 * ```
 */
export async function pipeAiSdkStream(
  aiResult: any,
  stream: AgentStream,
): Promise<AgentExecutionResult> {
  let fullText = "";
  const telemetry: TelemetryData = { framework: { adapter: "vercel-ai-sdk" } };

  try {
    // streamText returns a StreamTextResult with textStream
    if (aiResult?.textStream && Symbol.asyncIterator in aiResult.textStream) {
      for await (const chunk of aiResult.textStream) {
        if (typeof chunk === "string" && chunk.length > 0) {
          stream.delta(chunk);
          fullText += chunk;
        }
      }
    }
    // generateText returns a GenerateTextResult with .text
    else if (typeof aiResult?.text === "string") {
      fullText = aiResult.text;
      stream.delta(fullText);
    }
    // Fallback: try to iterate directly
    else if (aiResult && Symbol.asyncIterator in aiResult) {
      for await (const chunk of aiResult) {
        const text = typeof chunk === "string" ? chunk : chunk?.textDelta || chunk?.delta || "";
        if (text) {
          stream.delta(text);
          fullText += text;
        }
      }
    }

    // Token usage + model. On streamText these are Promises, so they must be awaited.
    // Prefer totalUsage (all steps) over usage (last step).
    const usage: any = await settle(aiResult?.totalUsage ?? aiResult?.usage);
    if (usage) {
      const prompt = numOrUndef(usage.inputTokens ?? usage.promptTokens ?? usage.prompt_tokens);
      const completion = numOrUndef(usage.outputTokens ?? usage.completionTokens ?? usage.completion_tokens);
      telemetry.llm_tokens = {
        prompt,
        completion,
        total: numOrUndef(usage.totalTokens ?? usage.total_tokens) ?? (prompt ?? 0) + (completion ?? 0),
        cached: numOrUndef(usage.cachedInputTokens),
        reasoning: numOrUndef(usage.reasoningTokens),
      };
    }
    const response: any = await settle(aiResult?.response);
    const modelId = response?.modelId ?? response?.model;
    if (typeof modelId === "string" && modelId) telemetry.model_used = modelId;
    // Gateways such as OpenRouter return the real cost in providerMetadata
    const meta: any = await settle(aiResult?.providerMetadata);
    const gatewayCost = numOrUndef(meta?.openrouter?.usage?.cost);
    if (gatewayCost !== undefined) {
      telemetry.cost_usd = gatewayCost;
      telemetry.cost_source = "provider";
    }

    // Extract tool calls if present
    if (aiResult?.toolCalls && Array.isArray(aiResult.toolCalls)) {
      telemetry.framework = {
        ...telemetry.framework,
        tool_calls: aiResult.toolCalls.length,
        tools_used: aiResult.toolCalls.map((tc: any) => tc.toolName || tc.name),
      };
    }
  } catch (err) {
    // Graceful fallback — adapter failures don't crash the agent
    if (fullText) {
      return { output: { text: fullText } as any, telemetry };
    }
    throw err;
  }

  return { output: { text: fullText } as any, telemetry };
}

// ─────────────────────────────────────────────────
//  OpenAI SDK Stream Adapter
// ─────────────────────────────────────────────────

/**
 * Pipes an OpenAI SDK chat.completions.create({ stream: true }) result.
 *
 * @example
 * ```ts
 * import OpenAI from "openai";
 * const client = new OpenAI();
 *
 * async execute({ input, stream }) {
 *   const openaiStream = await client.chat.completions.create({
 *     model: "gpt-4o-mini",
 *     messages: [{ role: "user", content: input.prompt }],
 *     stream: true,
 *   });
 *   return pipeOpenAiStream(openaiStream, stream);
 * }
 * ```
 */
export async function pipeOpenAiStream(
  openaiStream: any,
  stream: AgentStream,
): Promise<AgentExecutionResult> {
  let fullText = "";
  let model: string | undefined;
  let promptTokens: number | undefined;
  let completionTokens: number | undefined;
  let cached: number | undefined;
  let reasoning: number | undefined;
  let realCost: number | undefined;
  const telemetry: TelemetryData = { framework: { adapter: "openai" } };

  // Optional extras: cached/reasoning tokens, and `usage.cost` (returned by OpenRouter). Never required.
  const captureOpenAiExtras = (u: any) => {
    cached = numOrUndef(u?.prompt_tokens_details?.cached_tokens) ?? cached;
    reasoning = numOrUndef(u?.completion_tokens_details?.reasoning_tokens) ?? reasoning;
    realCost = numOrUndef(u?.cost) ?? realCost;
  };

  try {
    if (openaiStream && Symbol.asyncIterator in openaiStream) {
      for await (const chunk of openaiStream) {
        // Standard OpenAI chat completion chunk
        const delta = chunk?.choices?.[0]?.delta;
        if (delta?.content) {
          stream.delta(delta.content);
          fullText += delta.content;
        }

        // Tool calls in streaming mode
        if (delta?.tool_calls) {
          for (const tc of delta.tool_calls) {
            stream.activity("tool_call", {
              name: tc.function?.name,
              arguments: tc.function?.arguments,
            });
          }
        }

        // Capture model name
        if (chunk?.model && !model) {
          model = chunk.model;
        }

        // Usage in final chunk (OpenAI includes this with stream_options: { include_usage: true })
        if (chunk?.usage) {
          promptTokens = chunk.usage.prompt_tokens;
          completionTokens = chunk.usage.completion_tokens;
          captureOpenAiExtras(chunk.usage);
        }
      }
    }
    // Non-streaming response
    else if (openaiStream?.choices?.[0]?.message?.content) {
      fullText = openaiStream.choices[0].message.content;
      stream.delta(fullText);
      model = openaiStream.model;
      if (openaiStream.usage) {
        promptTokens = openaiStream.usage.prompt_tokens;
        completionTokens = openaiStream.usage.completion_tokens;
        captureOpenAiExtras(openaiStream.usage);
      }
    }

    if (model) telemetry.model_used = model;
    if (promptTokens !== undefined || completionTokens !== undefined) {
      telemetry.llm_tokens = {
        prompt: promptTokens,
        completion: completionTokens,
        total: (promptTokens ?? 0) + (completionTokens ?? 0),
        cached,
        reasoning,
      };
    }
    if (realCost !== undefined) {
      telemetry.cost_usd = realCost;
      telemetry.cost_source = "provider";
    }
  } catch (err) {
    if (fullText) {
      return { output: { text: fullText } as any, telemetry };
    }
    throw err;
  }

  return { output: { text: fullText } as any, telemetry };
}

// ─────────────────────────────────────────────────
//  LangGraph / LangChain Adapter
// ─────────────────────────────────────────────────

/**
 * Pipes a LangGraph compiled graph's stream into Catelog events.
 * Translates graph node transitions to progress events and token
 * deltas to stream chunks.
 *
 * @example
 * ```ts
 * async execute({ input, stream }) {
 *   return pipeLangGraphStream(compiledGraph, { input }, stream);
 * }
 * ```
 */
export async function pipeLangGraphStream(
  graph: any,
  graphInput: Record<string, unknown>,
  stream: AgentStream,
  options?: {
    signal?: AbortSignal;
    /** Pass `ctx.usage` to capture models and tokens of every LLM call in the graph automatically. */
    usage?: AgentUsage;
  }
): Promise<AgentExecutionResult> {
  let lastOutput: any = undefined;
  let nodeCount = 0;
  const nodesVisited: string[] = [];
  const telemetry: TelemetryData = { framework: { adapter: "langgraph" } };
  const callbacks = options?.usage ? [createLangChainUsageHandler(options.usage)] : undefined;

  try {
    // LangGraph .stream() returns an async iterable of state snapshots
    const streamMethod = graph.stream || graph.streamEvents;
    if (!streamMethod) {
      // Fallback: invoke synchronously
      const result = await graph.invoke(graphInput, { signal: options?.signal, callbacks });
      return { output: result as any, telemetry };
    }

    const graphStream = await streamMethod.call(graph, graphInput, {
      signal: options?.signal,
      callbacks,
      streamMode: "updates",
    });

    for await (const event of graphStream) {
      // Each event is typically { nodeName: nodeOutput }
      if (typeof event === "object" && event !== null) {
        for (const [nodeName, nodeOutput] of Object.entries(event)) {
          nodeCount++;
          nodesVisited.push(nodeName);
          stream.activity("graph_node", { node: nodeName, step: nodeCount });

          // If node output has messages with content, stream them
          if (nodeOutput && typeof nodeOutput === "object") {
            const messages = (nodeOutput as any).messages || [];
            for (const msg of messages) {
              if (msg?.content && typeof msg.content === "string") {
                stream.delta(msg.content);
              }
            }
          }

          lastOutput = nodeOutput;
        }
      }
    }

    telemetry.framework = {
      ...telemetry.framework,
      nodes_visited: nodesVisited,
      node_count: nodeCount,
    };
  } catch (err) {
    if (lastOutput) {
      return { output: lastOutput as any, telemetry };
    }
    throw err;
  }

  return { output: (lastOutput ?? {}) as any, telemetry };
}

// ─────────────────────────────────────────────────
//  Generic Async Iterable Adapter
// ─────────────────────────────────────────────────

/**
 * For any framework that produces an async iterable of text chunks
 * (CrewAI, LlamaIndex, custom generators, etc.)
 *
 * @example
 * ```ts
 * async execute({ input, stream }) {
 *   const chunks = myCustomAgentStream(input);
 *   return pipeAsyncIterableStream(chunks, stream);
 * }
 * ```
 */
export async function pipeAsyncIterableStream(
  iterable: AsyncIterable<string | { text?: string; content?: string; delta?: string }>,
  stream: AgentStream,
): Promise<AgentExecutionResult> {
  let fullText = "";
  const telemetry: TelemetryData = { framework: { adapter: "generic-iterable" } };

  for await (const chunk of iterable) {
    const text = typeof chunk === "string"
      ? chunk
      : (chunk?.text || chunk?.content || chunk?.delta || "");

    if (text) {
      stream.delta(text);
      fullText += text;
    }
  }

  return { output: { text: fullText } as any, telemetry };
}

// ─────────────────────────────────────────────────
//  OpenAI Responses API Adapter (client.responses.create)
// ─────────────────────────────────────────────────

/**
 * Pipes an OpenAI Responses API result into Catelog streaming events.
 * Supports:
 *   - Non-streaming: pass the resolved response object directly
 *   - Background polling: pass the polling loop as an async iterable via pollFn
 *
 * Emits:
 *   - stream.delta() for each text chunk / output_text
 *   - stream.activity("web_search") for search tool calls
 *   - stream.activity("reasoning") for reasoning steps
 *   - Real token telemetry from response.usage
 *
 * @example — Fast (non-streaming):
 * ```ts
 * const response = await client.responses.create({ model: "gpt-6-luna", input, tools: [{ type: "web_search" }] });
 * return pipeOpenAiResponsesStream(response, stream);
 * ```
 *
 * @example — Deep/background with polling:
 * ```ts
 * let res = await client.responses.create({ model: "gpt-5.4-mini", input, background: true });
 * while (res.status === "queued" || res.status === "in_progress") {
 *   stream.activity("polling", { status: res.status, taskId: res.id });
 *   await sleep(2000);
 *   res = await client.responses.retrieve(res.id);
 * }
 * return pipeOpenAiResponsesStream(res, stream);
 * ```
 */
export async function pipeOpenAiResponsesStream(
  response: any,
  stream: AgentStream,
): Promise<AgentExecutionResult> {
  const telemetry: TelemetryData = { framework: { adapter: "openai-responses" } };

  // ── Emit tool/activity events from output items ──
  const outputItems: any[] = response?.output ?? [];
  for (const item of outputItems) {
    if (item?.type === "web_search_call" || item?.type === "search") {
      stream.activity("web_search", {
        query: item?.action?.query ?? item?.query ?? undefined,
        status: item?.status ?? "completed",
      });
    }
    if (item?.type === "reasoning") {
      const reasoningText = item?.summary?.map((s: any) => s?.text).join(" ") ?? "";
      if (reasoningText) {
        stream.activity("reasoning", { summary: reasoningText.slice(0, 200) });
      }
    }
  }

  // ── Extract the final answer text ──
  const fullText: string = response?.output_text ?? "";
  if (fullText) {
    stream.delta(fullText);
  }

  // ── Real token telemetry ──
  if (response?.usage) {
    telemetry.llm_tokens = {
      prompt: response.usage.input_tokens ?? response.usage.prompt_tokens,
      completion: response.usage.output_tokens ?? response.usage.completion_tokens,
      total: response.usage.total_tokens ??
        ((response.usage.input_tokens ?? 0) + (response.usage.output_tokens ?? 0)),
      cached: numOrUndef(response.usage.input_tokens_details?.cached_tokens),
      reasoning: numOrUndef(response.usage.output_tokens_details?.reasoning_tokens),
    };
    // No price list here: the marketplace prices tokens. Only a cost the API itself returned is kept.
    const realCost = numOrUndef(response.usage.cost);
    if (realCost !== undefined) {
      telemetry.cost_usd = realCost;
      telemetry.cost_source = "provider";
    }
  }
  if (typeof response?.model === "string" && response.model) telemetry.model_used = response.model;

  return {
    output: { text: fullText } as any,
    telemetry,
  };
}


// ─────────────────────────────────────────────────
//  Claude Agent SDK Adapter (@anthropic-ai/claude-agent-sdk)
// ─────────────────────────────────────────────────

export interface ClaudeAgentStreamOptions<TOutput = unknown> {
  /**
   * Validate / shape the model's structured output (e.g. `(v) => MyZod.parse(v)`).
   * Only used when the query ran with `outputFormat: { type: "json_schema" }`.
   * Without it, structured output is returned as-is.
   */
  parse?: (raw: unknown) => TOutput;
  /** Aborting this signal calls `query.interrupt()` so a cancelled run stops spending money. Pass `ctx.signal`. */
  signal?: AbortSignal;
  /**
   * Called once with the final telemetry on success AND on failure.
   * Use it to record cost even for failed runs: `onUsage: (t) => metric.gauge("cost_usd", t.cost_usd ?? 0)`.
   */
  onUsage?: (telemetry: TelemetryData) => void;
  /** Tool names that are internal to Claude and should not be reported as activity (default: ["StructuredOutput"]). */
  hideTools?: string[];
}

/** How Claude Agent SDK failures map to Catelog error codes. */
const CLAUDE_API_ERRORS: Record<string, [string, boolean]> = {
  rate_limit: ["MODEL_RATE_LIMIT", true],
  overloaded: ["MODEL_RATE_LIMIT", true],
  server_error: ["UPSTREAM_TIMEOUT", true],
  authentication_failed: ["MODEL_AUTH_FAILED", false],
  billing_error: ["MODEL_BILLING_ERROR", false],
  model_not_found: ["MODEL_NOT_FOUND", false],
  invalid_request: ["MODEL_INVALID_REQUEST", false],
};

function claudeError(message: string, code: string, retryable: boolean): Error {
  return Object.assign(new Error(message), { code, retryable });
}

/**
 * Pipes a Claude Agent SDK `query()` into Catelog events and telemetry.
 *
 * - Tool calls (WebSearch, Read, Bash...) → `stream.activity()` + `stream.progress()`
 * - Assistant text → `stream.delta()`
 * - Cost, tokens, model, turns, per-tool counts → `telemetry`
 * - Failures → thrown errors with a Catelog `code` + `retryable`
 *   (`MODEL_RATE_LIMIT`, `BUDGET_EXCEEDED`, `TOOL_FAILURE`, ...)
 * - Returns `{ output, telemetry }`; `output` is the structured output if the query used
 *   `outputFormat: json_schema`, otherwise `{ text }`.
 *
 * @example
 * ```ts
 * import { query } from "@anthropic-ai/claude-agent-sdk";
 *
 * async execute({ input, stream, signal, metric }) {
 *   const run = query({ prompt: input.prompt, options: { model: "claude-haiku-5-5", maxBudgetUsd: 0.2 } });
 *   return pipeClaudeAgentStream(run, stream, { signal, onUsage: (t) => metric.gauge("cost_usd", t.cost_usd ?? 0) });
 * }
 * ```
 */
export async function pipeClaudeAgentStream<TOutput = any>(
  claudeStream: any,
  stream: AgentStream,
  options: ClaudeAgentStreamOptions<TOutput> = {},
): Promise<AgentExecutionResult<TOutput>> {
  const hidden = new Set(options.hideTools ?? ["StructuredOutput"]);
  const toolCalls: Record<string, number> = {};
  let toolCount = 0;
  let apiError: string | undefined;
  let streamedText = "";

  const onAbort = () => {
    try {
      void claudeStream?.interrupt?.();
    } catch {
      /* already finished */
    }
  };
  if (options.signal) {
    if (options.signal.aborted) onAbort();
    else options.signal.addEventListener("abort", onAbort, { once: true });
  }

  try {
    for await (const msg of claudeStream) {
      if (msg?.type === "assistant") {
        if (msg.error) apiError = msg.error;
        for (const block of msg.message?.content ?? []) {
          if (block?.type === "text" && block.text) {
            stream.delta(block.text);
            streamedText += block.text;
          } else if (block?.type === "tool_use" && !hidden.has(block.name)) {
            toolCalls[block.name] = (toolCalls[block.name] ?? 0) + 1;
            toolCount++;
            stream.activity(block.name, (block.input ?? {}) as Record<string, unknown>);
            stream.progress(Math.min(15 + toolCount * 12, 85), `Using ${block.name}`);
          }
        }
        continue;
      }
      if (msg?.type !== "result") continue;

      const usage: Record<string, any> = msg.modelUsage ?? {};
      const models = Object.values(usage);
      const sum = (f: (u: any) => number) => models.reduce((n, u) => n + (f(u) || 0), 0);
      const prompt = sum((u) => u.inputTokens + u.cacheReadInputTokens + u.cacheCreationInputTokens);
      const completion = sum((u) => u.outputTokens);
      // Per-model breakdown straight from the SDK, including the real cost it reports per model
      const modelBreakdown: ModelUsage[] = Object.entries(usage).map(([id, u]: [string, any]) => {
        const promptTokens = (u.inputTokens || 0) + (u.cacheReadInputTokens || 0) + (u.cacheCreationInputTokens || 0);
        const modelCost = numOrUndef(u.costUSD);
        return {
          id,
          provider: "anthropic",
          tokens: {
            prompt: promptTokens,
            completion: u.outputTokens || 0,
            total: promptTokens + (u.outputTokens || 0),
            cached: u.cacheReadInputTokens || undefined,
          },
          ...(modelCost !== undefined ? { cost_usd: modelCost, cost_source: "provider" as const } : {}),
        };
      });
      const totalCost = numOrUndef(msg.total_cost_usd);
      const telemetry: TelemetryData = {
        llm_tokens: { prompt, completion, total: prompt + completion },
        model_used: Object.keys(usage).join(",") || undefined,
        models: modelBreakdown.length ? modelBreakdown : undefined,
        ...(totalCost !== undefined ? { cost_usd: totalCost, cost_source: "provider" as const } : {}),
        framework: {
          adapter: "claude-agent-sdk",
          num_turns: msg.num_turns,
          duration_api_ms: msg.duration_api_ms,
          tool_calls: toolCalls,
          web_search_requests: sum((u) => u.webSearchRequests),
          cache_read_tokens: sum((u) => u.cacheReadInputTokens),
          cache_creation_tokens: sum((u) => u.cacheCreationInputTokens),
          stop_reason: msg.stop_reason,
          result_subtype: msg.subtype,
        },
      };
      options.onUsage?.(telemetry);

      if (msg.subtype === "success") {
        if (msg.structured_output !== undefined && msg.structured_output !== null) {
          let output: any;
          try {
            output = options.parse ? options.parse(msg.structured_output) : msg.structured_output;
          } catch (err) {
            throw claudeError(`Model output failed validation: ${(err as Error).message}`, "INTERNAL_CRASH", true);
          }
          return { output, telemetry };
        }
        return { output: { text: msg.result ?? streamedText } as any, telemetry };
      }

      if (apiError && CLAUDE_API_ERRORS[apiError]) {
        const [code, retryable] = CLAUDE_API_ERRORS[apiError];
        throw claudeError(`Claude API error: ${apiError}`, code, retryable);
      }
      if (msg.subtype === "error_max_budget_usd") throw claudeError("Run exceeded its cost cap", "BUDGET_EXCEEDED", false);
      if (msg.subtype === "error_max_turns") throw claudeError("Agent ran out of turns", "TOOL_FAILURE", true);
      if (msg.api_error_status === 429) throw claudeError("Model rate limit reached", "MODEL_RATE_LIMIT", true);
      throw claudeError(`Claude agent failed (${msg.subtype})`, "INTERNAL_CRASH", true);
    }
  } finally {
    options.signal?.removeEventListener("abort", onAbort);
  }

  if (options.signal?.aborted) throw Object.assign(new Error("aborted"), { name: "AbortError" });
  throw claudeError("Claude agent ended without a result", "INTERNAL_CRASH", true);
}
