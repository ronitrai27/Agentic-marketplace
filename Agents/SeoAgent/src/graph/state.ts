import { Annotation, messagesStateReducer } from "@langchain/langgraph";
import { BaseMessage } from "@langchain/core/messages";
import type { StaticCrawlResult } from "../activities/static-crawl.activity.js";
import type { BrowserEvidenceResult } from "../activities/browser-evidence.activity.js";
import type { GroundTruthResult } from "../activities/ground-truth.activity.js";
import type { GeoSemanticResult } from "../activities/geo-semantic.activity.js";
import type { LinkGraphResult } from "../activities/link-graph.activity.js";

export const SeoAgentState = Annotation.Root({
  // Chat history with messages state reducer
  messages: Annotation<BaseMessage[]>({
    reducer: messagesStateReducer,
    default: () => [],
  }),

  // Target audit URL
  currentUrl: Annotation<string | null>({
    reducer: (_, next) => next,
    default: () => null,
  }),

  // Pillar 1: Static Crawl
  scoutData: Annotation<StaticCrawlResult | null>({
    reducer: (_, next) => next,
    default: () => null,
  }),

  // Phase 1: Escalation flag
  requiresBrowser: Annotation<boolean>({
    reducer: (_, next) => next,
    default: () => false,
  }),

  // Pillar 2: Browser Evidence
  evidenceData: Annotation<BrowserEvidenceResult | null>({
    reducer: (_, next) => next,
    default: () => null,
  }),

  // Pillar 3: Ground Truth (PageSpeed & SerpApi)
  groundTruth: Annotation<GroundTruthResult | null>({
    reducer: (_, next) => next,
    default: () => null,
  }),

  // Pillar 4: GEO & Semantic Cannibalization
  geoData: Annotation<GeoSemanticResult | null>({
    reducer: (_, next) => next,
    default: () => null,
  }),

  // Pillar 5: Internal Link Graph & PageRank
  linkGraphData: Annotation<LinkGraphResult | null>({
    reducer: (_, next) => next,
    default: () => null,
  }),

  // Audit state flags
  auditComplete: Annotation<boolean>({
    reducer: (_, next) => next,
    default: () => false,
  }),

  lastError: Annotation<string | null>({
    reducer: (_, next) => next,
    default: () => null,
  }),

  // Guardrail safety flag
  guardrailBlocked: Annotation<boolean>({
    reducer: (_, next) => next,
    default: () => false,
  }),
});

export type SeoAgentStateType = typeof SeoAgentState.State;
