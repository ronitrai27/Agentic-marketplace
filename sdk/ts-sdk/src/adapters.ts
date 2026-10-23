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
  TelemetryData,
} from "./types.js";

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

    // Extract token usage if available
    if (aiResult?.usage) {
      telemetry.llm_tokens = {
        prompt: aiResult.usage.promptTokens ?? aiResult.usage.prompt_tokens,
        completion: aiResult.usage.completionTokens ?? aiResult.usage.completion_tokens,
        total: aiResult.usage.totalTokens ?? aiResult.usage.total_tokens,
      };
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
  const telemetry: TelemetryData = { framework: { adapter: "openai" } };

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
      }
    }

    if (model) telemetry.model_used = model;
    if (promptTokens !== undefined || completionTokens !== undefined) {
      telemetry.llm_tokens = {
        prompt: promptTokens,
        completion: completionTokens,
        total: (promptTokens ?? 0) + (completionTokens ?? 0),
      };
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
  options?: { signal?: AbortSignal }
): Promise<AgentExecutionResult> {
  let lastOutput: any = undefined;
  let nodeCount = 0;
  const nodesVisited: string[] = [];
  const telemetry: TelemetryData = { framework: { adapter: "langgraph" } };

  try {
    // LangGraph .stream() returns an async iterable of state snapshots
    const streamMethod = graph.stream || graph.streamEvents;
    if (!streamMethod) {
      // Fallback: invoke synchronously
      const result = await graph.invoke(graphInput, { signal: options?.signal });
      return { output: result as any, telemetry };
    }

    const graphStream = await streamMethod.call(graph, graphInput, {
      signal: options?.signal,
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
