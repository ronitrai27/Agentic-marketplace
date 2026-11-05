import { AIMessage } from "@langchain/core/messages";
import type { SeoAgentStateType } from "../state.js";
import { evaluateGuardrails } from "../../guardrails/index.js";

/**
 * Guardrail Node: Evaluates every incoming user message before routing to Supervisor.
 * Enforces fuzzy ban lists, Presidio PII redaction, heuristic jailbreaks, and JEV semantic checks.
 */
export async function guardrailNode(state: SeoAgentStateType): Promise<Partial<SeoAgentStateType>> {
  const lastMessage = state.messages[state.messages.length - 1];
  const query = typeof lastMessage?.content === "string" ? lastMessage.content : "";

  if (!query.trim()) {
    return { guardrailBlocked: false };
  }

  const guard = await evaluateGuardrails(query);

  if (!guard.isAllowed) {
    console.log(
      `🛡️ [Guardrail] ❌ BLOCKED (${guard.totalDurationMs}ms) | Reason: ${guard.rejectionReason} | JEV: ${guard.flags.evaluationSource} (inj: ${guard.flags.injectionScore}, tox: ${guard.flags.toxicityScore})`
    );

    return {
      guardrailBlocked: true,
      lastError: guard.rejectionReason,
      messages: [new AIMessage(`🚨 **Blocked by Security Guardrail**: ${guard.rejectionReason}`)],
    };
  }

  console.log(
    `🛡️ [Guardrail] ✅ PASSED (${guard.totalDurationMs}ms) | PII sanitized: ${guard.flags.hasPii} | JEV: ${guard.flags.evaluationSource} (inj: ${guard.flags.injectionScore}, tox: ${guard.flags.toxicityScore})`
  );

  return {
    guardrailBlocked: false,
    lastError: null,
  };
}

/**
 * Conditional router: If blocked by guardrail, terminate immediately; otherwise proceed to supervisor.
 */
export function routeAfterGuardrail(state: SeoAgentStateType): "supervisor" | "__end__" {
  if (state.guardrailBlocked) {
    return "__end__";
  }
  return "supervisor";
}
