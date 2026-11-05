import { Annotation } from "@langchain/langgraph";
import type { CrawlTarget, SeoIssue } from "./types.js";

/**
 * Enterprise LangGraph State Annotation for SeoAgent.
 * Follows durable state channel conventions for checkpointing and replay.
 */
export const SeoAgentStateAnnotation = Annotation.Root({
  /**
   * Root target URL being audited or crawled.
   */
  targetDomain: Annotation<string>(),

  /**
   * Queue of URLs discovered and pending inspection.
   */
  crawlQueue: Annotation<CrawlTarget[]>({
    reducer: (current, update) => [...current, ...update],
    default: () => [],
  }),

  /**
   * Set of URLs already visited and processed.
   */
  visitedUrls: Annotation<string[]>({
    reducer: (current, update) => Array.from(new Set([...current, ...update])),
    default: () => [],
  }),

  /**
   * Verified SEO issues accumulated with immutable evidence packages.
   */
  issues: Annotation<SeoIssue[]>({
    reducer: (current, update) => [...current, ...update],
    default: () => [],
  }),

  /**
   * Execution status flag for the current run.
   */
  status: Annotation<"idle" | "running" | "completed" | "failed">({
    reducer: (_, update) => update,
    default: () => "idle",
  }),

  /**
   * Any top-level error context captured during workflow execution.
   */
  error: Annotation<string | null>({
    reducer: (_, update) => update,
    default: () => null,
  }),
});

export type SeoAgentState = typeof SeoAgentStateAnnotation.State;
