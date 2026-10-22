import { env } from "./config/env.js";
import { SeoAgentStateAnnotation } from "./core/state.js";
import type { SeoIssue, EvidencePackage } from "./core/types.js";

export * from "./core/types.js";
export * from "./core/state.js";
export * from "./config/env.js";
export * from "./activities/index.js";
export * from "./temporal/connection.js";
export * from "./temporal/workflows/index.js";
export * from "./guardrails/index.js";
export * from "./jev/escalation-gate.js";

console.log("🚀 SeoAgent Core Initialized");
console.log(`Environment: ${env.NODE_ENV} | Temporal Queue: ${env.TEMPORAL_TASK_QUEUE}`);
