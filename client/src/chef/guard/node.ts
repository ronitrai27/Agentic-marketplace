import type { GraphNode } from "@langchain/langgraph";
import { AIMessage } from "@langchain/core/messages";
import { ChefGraphState } from "../state";
import { askJev, JevError } from "./jev";
import { GUARD_QUESTIONS } from "./questions";
import { decide } from "./router";

/** Hard-coded reply for a refused turn. Never produced by a model. */
export const REFUSAL_TEXT =
  "I can only help you find, compare and run agents on Catelog. Tell me the task you want done, for example “research my competitors” or “find leads for my agency”.";

const MAX_CHARS = 4000;

function lastText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((p) => (typeof p === "string" ? p : (p as { text?: string }).text ?? "")).join(" ");
  return "";
}

/** First layer: one Jev request (jailbreak, hijack, scope, route), then a plain function decides. */
export const guardNode: GraphNode<typeof ChefGraphState> = async (state) => {
  const started = Date.now();
  const msgs = state.messages;
  const human = [...msgs].reverse().find((m) => m.type === "human");
  const lastAssistant = [...msgs].reverse().find((m) => m.type === "ai");
  const text = lastText(human?.content).slice(0, MAX_CHARS);

  let res = null;
  let error: string | undefined;
  try {
    res = await askJev(
      { message: text, phase: state.phase, last_assistant_message: lastText(lastAssistant?.content).slice(0, 500) },
      GUARD_QUESTIONS,
    );
  } catch (e) {
    error = e instanceof JevError ? e.message : "unexpected error";
  }

  const d = decide(res, state.phase);
  // Console only. The verdict is never sent to the browser.
  console.log(
    `[chef:guard] chat=${state.chatId} action=${d.action} reason=${d.reason} model=${d.model} hardened=${d.hardened} ` +
      `scores=${JSON.stringify(d.scores)} ms=${Date.now() - started}${error ? ` error="${error}"` : ""}`,
  );

  return {
    blocked: d.action === "block",
    modelKind: d.model,
    hardened: d.hardened,
    guards: [
      {
        messageIndex: msgs.length - 1,
        jailbreak: d.scores?.jailbreak ?? 0,
        hijack: d.scores?.hijack ?? 0,
        inScope: d.scores?.inScope ?? 0,
        route: (d.scores?.chitchat ?? 0) >= 0.5 ? ("chitchat" as const) : ("task" as const),
        routeConfidence: 1,
        action: d.action === "block" ? ("block" as const) : d.reason === "jev_unavailable" ? ("uncertain" as const) : ("allow" as const),
        model: d.model,
      },
    ],
  };
};

/** Refused turn: the fixed reply goes into the thread as the assistant's message. */
export const refuseNode: GraphNode<typeof ChefGraphState> = async () => ({
  messages: [new AIMessage(REFUSAL_TEXT)],
});

/** Placeholder for the next layer (intent). It only marks the phase for now. */
export const intentNode: GraphNode<typeof ChefGraphState> = async () => ({ phase: "understand" as const });
