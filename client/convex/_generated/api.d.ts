/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as agentPage from "../agentPage.js";
import type * as agents from "../agents.js";
import type * as apiKeys from "../apiKeys.js";
import type * as apiKeysActions from "../apiKeysActions.js";
import type * as auth from "../auth.js";
import type * as chat from "../chat.js";
import type * as chatRuns from "../chatRuns.js";
import type * as chefAgents from "../chefAgents.js";
import type * as creatorRevenue from "../creatorRevenue.js";
import type * as crons from "../crons.js";
import type * as escrow from "../escrow.js";
import type * as health from "../health.js";
import type * as http from "../http.js";
import type * as ledger from "../ledger.js";
import type * as mcpAgents from "../mcpAgents.js";
import type * as mcpRuns from "../mcpRuns.js";
import type * as n8nAgents from "../n8nAgents.js";
import type * as revenue from "../revenue.js";
import type * as reviews from "../reviews.js";
import type * as runs from "../runs.js";
import type * as temporal from "../temporal.js";
import type * as transactions from "../transactions.js";
import type * as wallet from "../wallet.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  agentPage: typeof agentPage;
  agents: typeof agents;
  apiKeys: typeof apiKeys;
  apiKeysActions: typeof apiKeysActions;
  auth: typeof auth;
  chat: typeof chat;
  chatRuns: typeof chatRuns;
  chefAgents: typeof chefAgents;
  creatorRevenue: typeof creatorRevenue;
  crons: typeof crons;
  escrow: typeof escrow;
  health: typeof health;
  http: typeof http;
  ledger: typeof ledger;
  mcpAgents: typeof mcpAgents;
  mcpRuns: typeof mcpRuns;
  n8nAgents: typeof n8nAgents;
  revenue: typeof revenue;
  reviews: typeof reviews;
  runs: typeof runs;
  temporal: typeof temporal;
  transactions: typeof transactions;
  wallet: typeof wallet;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  betterAuth: import("../betterAuth/_generated/component.js").ComponentApi<"betterAuth">;
};
