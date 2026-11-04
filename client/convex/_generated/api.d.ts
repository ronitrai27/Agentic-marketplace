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
import type * as crons from "../crons.js";
import type * as http from "../http.js";
import type * as runs from "../runs.js";
import type * as search from "../search.js";
import type * as temporal from "../temporal.js";
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
  crons: typeof crons;
  http: typeof http;
  runs: typeof runs;
  search: typeof search;
  temporal: typeof temporal;
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
