import { generateText, stepCountIs, streamText, type ModelMessage } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { createGroq } from "@ai-sdk/groq";
import type { AgentUsage } from "catelog";
import { groqApiKey } from "../config.js";

const groq = (model: string) => createGroq({ apiKey: groqApiKey() })(model);

export const HAIKU_MODEL = process.env.REPORT_HAIKU_MODEL ?? "claude-haiku-5-5";
export const GROQ_MODEL = process.env.GROQ_MODEL ?? "openai/gpt-oss-120b";
/** Haiku 5.5 otherwise spends the whole output cap on thinking and returns no text. */
const NO_THINKING = { anthropic: { thinking: { type: "disabled" as const } } };
const MAX_WEB_SEARCHES = Number(process.env.REPORT_MAX_WEB_SEARCHES ?? 3);

interface CallOptions {
  system: string;
  prompt: string;
  usage: AgentUsage;
  signal?: AbortSignal;
  maxTokens?: number;
}

type Usage = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cachedInputTokens?: number;
  reasoningTokens?: number;
};

function record(
  usage: AgentUsage,
  model: string,
  provider: string,
  u: Usage | undefined,
  t0: number,
): void {
  usage.record({
    model,
    provider,
    tokens: {
      prompt: u?.inputTokens,
      completion: u?.outputTokens,
      total: u?.totalTokens,
      cached: u?.cachedInputTokens,
      reasoning: u?.reasoningTokens,
    },
    latencyMs: Date.now() - t0,
  });
}

function messages(o: CallOptions): ModelMessage[] {
  return [{ role: "user", content: o.prompt }];
}

/** Groq (gpt-oss-120b): fast notes from the topic or the uploaded document. */
export async function groqText(o: CallOptions): Promise<string> {
  const t0 = Date.now();
  const res = await generateText({
    model: groq(GROQ_MODEL),
    system: o.system,
    messages: messages(o),
    // gpt-oss reasons first and that counts against this budget, so keep it generous.
    maxOutputTokens: o.maxTokens ?? 4096,
    providerOptions: { groq: { reasoningEffort: "low" } },
    abortSignal: o.signal,
    maxRetries: 4,
  });
  record(o.usage, GROQ_MODEL, "groq", res.usage, t0);
  if (!res.text.trim()) throw new Error("Groq returned no text");
  return res.text;
}

/** Claude Haiku: final writing, streamed to the buyer as it is produced. */
export async function haikuText(o: CallOptions & { onToken?: (t: string) => void }): Promise<string> {
  const t0 = Date.now();
  const res = streamText({
    model: anthropic(HAIKU_MODEL),
    providerOptions: NO_THINKING,
    system: o.system,
    messages: messages(o),
    maxOutputTokens: o.maxTokens ?? 4096,
    abortSignal: o.signal,
  });
  let text = "";
  for await (const piece of res.textStream) {
    text += piece;
    o.onToken?.(piece);
  }
  record(o.usage, HAIKU_MODEL, "anthropic", await res.usage, t0);
  if (text.trim()) return text;

  // An empty stream (seen once with a long prompt): ask again without streaming and say why.
  console.warn(`[ReportAgent] Claude streamed no text (finish: ${await res.finishReason}); retrying once`);
  const t1 = Date.now();
  const retry = await generateText({
    model: anthropic(HAIKU_MODEL),
    providerOptions: NO_THINKING,
    system: o.system,
    messages: messages(o),
    maxOutputTokens: o.maxTokens ?? 4096,
    abortSignal: o.signal,
  });
  record(o.usage, HAIKU_MODEL, "anthropic", retry.usage, t1);
  if (retry.text) o.onToken?.(retry.text);
  return retry.text;
}

export interface ResearchResult {
  text: string;
  sources: string[];
  searched: boolean;
}

/**
 * Claude Haiku with Anthropic's server-side web search. Falls back to a plain call if web search
 * is not enabled for the API key's organisation, so the run still completes.
 */
export async function haikuResearch(o: CallOptions): Promise<ResearchResult> {
  const run = async (withSearch: boolean): Promise<ResearchResult> => {
    const t0 = Date.now();
    const res = await generateText({
      model: anthropic(HAIKU_MODEL),
      providerOptions: NO_THINKING,
      system: o.system,
      messages: messages(o),
      maxOutputTokens: o.maxTokens ?? 2000,
      abortSignal: o.signal,
      ...(withSearch
        ? {
            tools: { web_search: anthropic.tools.webSearch_20250305({ maxUses: MAX_WEB_SEARCHES }) },
            stopWhen: stepCountIs(MAX_WEB_SEARCHES + 2),
          }
        : {}),
    });
    record(o.usage, HAIKU_MODEL, "anthropic", res.totalUsage, t0);
    const sources = [...new Set(res.sources.flatMap((s) => (s.sourceType === "url" ? [s.url] : [])))];
    return { text: res.text, sources, searched: withSearch };
  };

  try {
    return await run(true);
  } catch (err) {
    if (o.signal?.aborted) throw err;
    console.warn(`[ReportAgent] web search failed, continuing without it: ${(err as Error).message}`);
    return run(false);
  }
}
