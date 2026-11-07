import { AsyncLocalStorage } from "node:async_hooks";
import type { ConvexHttpClient } from "convex/browser";

/**
 * Per-request context for tools. The graph is built once per process, but the Convex client carries the
 * signed-in user's token, so the route sets this at the start of each request and tools read it from here.
 * It never goes into the checkpoint.
 */
export type ChefRequest = {
  convex: ConvexHttpClient;
  /** What the human actually typed this turn. Tools trust this over anything the model passes in. */
  lastUserText: string;
};

export const chefRequest = new AsyncLocalStorage<ChefRequest>();
