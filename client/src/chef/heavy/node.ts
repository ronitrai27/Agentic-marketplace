import type { GraphNode } from "@langchain/langgraph";
import { ChatOpenAI } from "@langchain/openai";
import {
  AIMessage,
  AIMessageChunk,
  SystemMessage,
  ToolMessage,
  type BaseMessage,
} from "@langchain/core/messages";
import { ChefGraphState, chefModelId } from "../state";
import { HEAVY_SYSTEM_PROMPT } from "./prompt";
import { CHEF_TOOLS, runTool } from "../tools";

const MAX_STEPS = 4; // model calls per turn: tool, tool, ..., answer
const HISTORY = 20;

/** Events the node streams to the browser (the route forwards them as SSE). */
export type HeavyEvent =
  | { t: "reasoning"; id: string; text: string }
  | { t: "reasoning_end"; id: string; durationMs: number }
  | { t: "tool"; id: string; name: string; status: "running" | "done" | "error"; args: unknown; output?: string }
  | {
      t: "agents";
      id: string;
      needsChoice: boolean;
      preselect?: string;
      agents: { slug: string; name: string; logoUrl?: string; ratingAvg: number; ratingCount: number; models: { id: string; provider?: string }[] }[];
    }
  | { t: "token"; text: string };

const models = new Map<boolean, ReturnType<typeof build>>();
function build(reasoning: boolean) {
  const base = new ChatOpenAI({
    model: chefModelId("heavy"),
    apiKey: process.env.OPENAI_API_KEY ?? process.env.OPENAPI_KEY,
    streaming: true,
    ...(reasoning
      ? // a short reasoning summary is what the first "Thinking" bubble shows
        { useResponsesApi: true, reasoning: { effort: "low" as const, summary: "auto" as const } }
      : {}),
  });
  return base.bindTools(CHEF_TOOLS);
}
const getModel = (reasoning: boolean) => {
  let m = models.get(reasoning);
  if (!m) models.set(reasoning, (m = build(reasoning)));
  return m;
};

/** Pieces of one streamed chunk: answer text, reasoning-summary text. Handles both the Responses and Chat Completions shapes. */
function parts(chunk: AIMessageChunk): { text: string; reasoning: string; partIndex?: number } {
  const c = chunk.content;
  if (typeof c === "string") return { text: c, reasoning: "" };
  let text = "";
  let reasoning = "";
  let partIndex: number | undefined;
  for (const b of c as Array<Record<string, unknown>>) {
    if (b.type === "text" && typeof b.text === "string") text += b.text;
    else if (b.type === "reasoning") {
      if (typeof b.reasoning === "string") reasoning += b.reasoning;
      if (typeof b.index === "number") partIndex = b.index;
    }
  }
  return { text, reasoning, partIndex };
}

/** History for the model: recent, and never starting on a tool result whose call was cut off. */
function window(messages: BaseMessage[]): BaseMessage[] {
  const recent = messages.slice(-HISTORY);
  let i = 0;
  while (i < recent.length && recent[i].type === "tool") i++;
  return recent.slice(i);
}

const textOf = (m: BaseMessage) =>
  typeof m.content === "string"
    ? m.content
    : (m.content as Array<{ type?: string; text?: string }>).map((b) => (b.type === "text" ? (b.text ?? "") : "")).join("");

/**
 * Heavy layer: the tool-using model. It reasons (a short summary is streamed first), calls find_agents, and
 * answers. Everything the user should watch (reasoning, tool runs, the agent picker, answer tokens) goes out
 * through `writer` as it happens; the checkpoint only keeps the messages.
 */
export const heavyNode: GraphNode<typeof ChefGraphState> = async (state, config) => {
  const emit = (e: HeavyEvent) => config.writer?.(e);
  const started = Date.now();
  const convo: BaseMessage[] = window(state.messages);
  const produced: BaseMessage[] = [];
  let useReasoning = true;

  for (let step = 0; step < MAX_STEPS; step++) {
    const rid = `r${step}`;
    let reasoningStarted = 0;
    let reasoningClosed = false;
    let lastPart: number | undefined;
    const closeReasoning = () => {
      if (reasoningStarted && !reasoningClosed) {
        reasoningClosed = true;
        emit({ t: "reasoning_end", id: rid, durationMs: Date.now() - reasoningStarted });
      }
    };

    let full: AIMessageChunk | undefined;
    try {
      const stream = await getModel(useReasoning).stream([new SystemMessage(HEAVY_SYSTEM_PROMPT), ...convo, ...produced]);
      for await (const chunk of stream) {
        full = full ? full.concat(chunk) : chunk;
        const p = parts(chunk);
        if (p.reasoning) {
          if (!reasoningStarted) reasoningStarted = Date.now();
          // a new summary part starts a new paragraph
          const gap = lastPart !== undefined && p.partIndex !== undefined && p.partIndex !== lastPart ? "\n\n" : "";
          if (p.partIndex !== undefined) lastPart = p.partIndex;
          emit({ t: "reasoning", id: rid, text: gap + p.reasoning });
        }
        if (p.text) {
          closeReasoning();
          emit({ t: "token", text: p.text });
        }
      }
    } catch (e) {
      console.error(`[chef:heavy] chat=${state.chatId} step=${step} failed:`, e instanceof Error ? e.message : e);
      if (useReasoning && step === 0 && !full) {
        // the model may not accept reasoning summaries: retry the step once as a plain call
        useReasoning = false;
        step--;
        continue;
      }
      closeReasoning();
      const msg = new AIMessage("Sorry, I hit a problem while working on that. Please try again.");
      emit({ t: "token", text: textOf(msg) });
      return { messages: [...produced, msg] };
    }
    closeReasoning();

    const calls = full?.tool_calls ?? [];
    const ai = new AIMessage({ content: full ? textOf(full) : "", tool_calls: calls });
    produced.push(ai);

    if (calls.length === 0) {
      if (!textOf(ai).trim()) {
        const fallback = "I couldn't put an answer together. Could you rephrase what you need?";
        produced[produced.length - 1] = new AIMessage(fallback);
        emit({ t: "token", text: fallback });
      }
      console.log(`[chef:heavy] chat=${state.chatId} steps=${step + 1} ms=${Date.now() - started}`);
      return { messages: produced };
    }

    for (const call of calls) {
      const id = call.id ?? `${rid}-${call.name}`;
      emit({ t: "tool", id, name: call.name, status: "running", args: call.args });
      const res = await runTool(call.name, call.args);
      emit({ t: "tool", id, name: call.name, status: res.ok ? "done" : "error", args: call.args, output: res.text.slice(0, 2000) });
      if (res.agents?.ok && res.agents.agents.length > 0) {
        emit({
          t: "agents",
          id,
          needsChoice: res.agents.needsChoice,
          preselect: res.agents.preselect,
          agents: res.agents.agents,
        });
      }
      produced.push(new ToolMessage({ content: res.text, tool_call_id: id, name: call.name }));
    }
  }

  const msg = new AIMessage("I went around in circles on that. Tell me the task again in a sentence and I'll look again.");
  emit({ t: "token", text: textOf(msg) });
  return { messages: [...produced, msg] };
};
