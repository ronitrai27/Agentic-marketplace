import { evaluateEscalationGate, type EscalationDecision } from "../jev/escalation-gate.js";
import type { StaticCrawlResult } from "./static-crawl.activity.js";

/**
 * Temporal Activity wrapping JEV Hydration & Escalation Gate
 */
export async function escalationGateActivity(
  staticResult: StaticCrawlResult
): Promise<EscalationDecision> {
  return await evaluateEscalationGate(staticResult);
}
