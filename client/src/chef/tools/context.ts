import { AsyncLocalStorage } from "node:async_hooks";
import type { ConvexHttpClient } from "convex/browser";

/**
 * Per-request context for tools. The graph is built once per process, but the Convex client carries the
 * signed-in user's token, so the route sets this at the start of each request and tools read it from here.
 * It never goes into the checkpoint.
 */
/** Settles when the guard has decided: "instant" (chit-chat answer allowed), "heavy" (a task), or "drop" (refused). */
export type GuardGate = { promise: Promise<"instant" | "heavy" | "drop">; settle: (v: "instant" | "heavy" | "drop") => void };
export function createGuardGate(): GuardGate {
  let settle!: GuardGate["settle"];
  const promise = new Promise<"instant" | "heavy" | "drop">((r) => (settle = r));
  return { promise, settle };
}

export type ChefRequest = {
  /** Lets the speculative instant model stop the moment the guard says the turn is a task, so the heavy model starts right away. */
  gate?: GuardGate;
  convex: ConvexHttpClient;
  /** The chat this turn belongs to (proposals and the runs they start are tied to it). */
  chatId?: string;
  /** What the human actually typed this turn. Tools trust this over anything the model passes in. */
  lastUserText: string;
  /** Sends a live event to the user's browser (e.g. a "notice" toast) while the tool is still working. */
  notify?: (event: string, data: unknown) => void;
};

export const chefRequest = new AsyncLocalStorage<ChefRequest>();
