import { z } from "zod";

/**
 * Chef state: everything a LangGraph thread keeps in its Postgres checkpoint.
 * Rules: the LLM never writes candidates, jobs, money or ids; tools and code do. `chatId` is the thread id.
 */

export const Phase = z.enum([
  "understand", // read the message, run guardrails
  "clarify", // waiting on the human (budget, missing detail)
  "search", // finding and ranking agents
  "choose", // waiting for the human to pick 1..N agents
  "prepare", // filling each agent's input
  "confirm", // waiting for the human to approve the holds
  "running", // runs started, waiting on them
  "present", // showing results
]);
export type Phase = z.infer<typeof Phase>;

/** What the user wants, extracted once per task. */
export const Intent = z.object({
  task: z.string(),
  /** Total credit cap for this request; null = not given (chef asks). */
  budgetCredits: z.number().nullable(),
  /** "research + competitor" style: several separate agents in parallel, never chained. */
  wantsMultiple: z.boolean(),
  constraints: z.array(z.string()),
});
export type Intent = z.infer<typeof Intent>;

/** Jev guardrail verdict for one user message. */
export const Guard = z.object({
  messageIndex: z.number(),
  jailbreak: z.number(), // noul 0..1
  hijack: z.number(),
  inScope: z.number(),
  route: z.enum(["chitchat", "task"]),
  routeConfidence: z.number(),
  action: z.enum(["allow", "block", "uncertain"]),
  /** Which GPT answers: instant = GPT_INSTANT_MODEL (chit-chat), heavy = GPT_HEAVY_MODEL (tools and tasks). */
  model: z.enum(["instant", "heavy"]),
});
export type Guard = z.infer<typeof Guard>;

export const InputField = z.object({ name: z.string(), type: z.string(), required: z.boolean() });

/** An agent that matched, built from tools only (Typesense and Convex facts), never by the LLM. */
export const Candidate = z.object({
  slug: z.string(),
  name: z.string(),
  /** Worst-case credits held for one run. The charge settles after the run; the rest is released. */
  holdCredits: z.number(),
  pricingShape: z.enum(["per_run", "per_unit", "tiered"]),
  /** Only whether it is negotiable; the creator's floor is never in state. */
  negotiable: z.boolean(),
  ratingAvg: z.number(),
  ratingCount: z.number(),
  successRate: z.number().nullable(),
  avgLatencyMs: z.number().nullable(),
  /** Relevance of the agent to the task, 0..1. */
  fit: z.number(),
  /** Deterministic composite used for ordering. */
  score: z.number(),
  reasons: z.array(z.string()),
  inputFields: z.array(InputField),
});
export type Candidate = z.infer<typeof Candidate>;

/** One selected agent's run. Agents run in parallel; each has its own job and its own output. */
export const Job = z.object({
  slug: z.string(),
  input: z.record(z.string(), z.unknown()).nullable(),
  inputStatus: z.enum(["pending", "needs_user", "ready"]),
  missingFields: z.array(z.string()),
  runId: z.string().nullable(),
  holdCredits: z.number().nullable(),
  status: z.enum(["planned", "held", "running", "succeeded", "failed", "cancelled"]),
  /** Clipped and untrusted: shown to the human, never fed back to a tool-using model. */
  resultSummary: z.string().nullable(),
  error: z.string().nullable(),
});
export type Job = z.infer<typeof Job>;

export const ChefState = z.object({
  chatId: z.string().uuid(),
  userId: z.string(),
  phase: Phase,
  intent: Intent.nullable(),
  candidates: z.array(Candidate),
  selectedSlugs: z.array(z.string()),
  /** Keyed by agent slug so parallel branches merge without overwriting each other. */
  jobs: z.record(z.string(), Job),
  /** Credits held or spent in this chat, for the spend guardrail. */
  spentCredits: z.number(),
  guards: z.array(Guard),
  // The append-only `messages` history sits beside this in the LangGraph annotation.
});
export type ChefState = z.infer<typeof ChefState>;

/** Model id for simple chat vs tool/task work. Ids come from env, never hard-coded. */
export function chefModelId(kind: "instant" | "heavy"): string {
  const name = kind === "instant" ? "GPT_INSTANT_MODEL" : "GPT_HEAVY_MODEL";
  const id = process.env[name];
  if (!id) throw new Error(`Set ${name} in the environment.`);
  return id;
}

export function initialChefState(chatId: string, userId: string): ChefState {
  return {
    chatId,
    userId,
    phase: "understand",
    intent: null,
    candidates: [],
    selectedSlugs: [],
    jobs: {},
    spentCredits: 0,
    guards: [],
  };
}

// ─── LangGraph state (what the compiled graph reads and writes, checkpointed per thread) ───

import { StateSchema, MessagesValue, ReducedValue } from "@langchain/langgraph";

export const ChefGraphState = new StateSchema({
  /** Append-only chat history. */
  messages: MessagesValue,
  chatId: z.string(),
  userId: z.string(),
  phase: Phase.default("understand"),
  intent: Intent.nullable().default(null),
  /** Replaced on every search. */
  candidates: z.array(Candidate).default(() => []),
  selectedSlugs: z.array(z.string()).default(() => []),
  /** Keyed by agent slug; parallel branches each write their own key and the reducer merges them. */
  jobs: new ReducedValue(z.record(z.string(), Job).default(() => ({})), {
    reducer: (current, update) => ({ ...current, ...update }),
  }),
  spentCredits: new ReducedValue(z.number().default(0), { reducer: (a, b) => a + b }),
  /** Set by the guard on every turn: true means the turn is refused and no further step runs. */
  blocked: z.boolean().default(false),
  /** Which GPT answers this turn (chosen by the guard). */
  modelKind: z.enum(["instant", "heavy"]).default("heavy"),
  /** The instant model's answer, produced in parallel with the guard and kept only if the guard allows it. */
  draft: z.string().default(""),
  /** The guard asked for the hardened system prompt. */
  hardened: z.boolean().default(false),
  guards: new ReducedValue(z.array(Guard).default(() => []), { reducer: (a, b) => [...a, ...b] }),
});
export type ChefGraphState = typeof ChefGraphState.State;
