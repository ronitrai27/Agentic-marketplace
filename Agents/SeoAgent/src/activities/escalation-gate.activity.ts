import { evaluateEscalationGate, type EscalationDecision } from "../jev/escalation-gate.js";
import type { StaticCrawlResult } from "./static-crawl.activity.js";

/**
 * Temporal Activity wrapping JEV Hydration & Escalation Gate
 */
export async function escalationGateActivity(
  staticResult: StaticCrawlResult
): Promise<EscalationDecision> {
  const decision = await evaluateEscalationGate(staticResult);
  console.log(
    `⚡ [Temporal Activity: JEV Gate] Decision: ${decision.decision} | Needs Browser: ${decision.requiresBrowser} | Conf: ${decision.confidence} | Source: ${decision.source}`
  );
  if (!decision.requiresBrowser) {
    console.log(
      `⚡ [Temporal Activity: JEV Gate] ⏩ Browserbase BYPASSED because static HTML payload was complete. Zero cloud browser cost.`
    );
  } else {
    console.log(
      `⚡ [Temporal Activity: JEV Gate] 🌐 Browserbase TRIGGERED: Client SPA hydration required.`
    );
  }
  return decision;
}
