import { interrupt, type GraphNode } from "@langchain/langgraph";
import { AIMessage, ToolMessage } from "@langchain/core/messages";
import { ChefGraphState, HitlDecision } from "../state";

/** The fixed reply for each answer. No model call: the facts are known and nothing here should be reworded. */
export function hitlReply(d: HitlDecision, names: string[], credits: number): string {
  const who = names.join(" and ");
  if (d.decision === "approved") {
    return (
      `Approved. ${credits} credits are held for ${who}. Fill in the input above and press Run: I'll send it to the marketplace ` +
      `and open the live run in the side sheet. ${names.length > 1 ? "They run" : "It runs"} in the background, so keep asking me anything; ` +
      "I'll post here as soon as the output is ready."
    );
  }
  if (d.decision === "failed") {
    return (
      `I couldn't start ${who}: ${d.reason ?? "something went wrong"}. Nothing was held or charged. ` +
      "If you want, I can look for other agents that can do this task."
    );
  }
  if (d.decision === "expired") return `That approval for ${who} expired after 10 minutes, so nothing was held. Ask me again whenever you want to run it.`;
  return `Okay, I won't run ${who}. Nothing was held or charged.`;
}

/**
 * Human in the loop. The graph stops here with the proposal until the route resumes it with
 * Command({ resume: HitlDecision }); while it waits the route refuses new questions in this chat.
 * The decision was already recorded in Convex (and approved runs held) before the resume.
 */
export const hitlNode: GraphNode<typeof ChefGraphState> = async (state) => {
  const p = state.proposal;
  if (!p) return {};
  const raw = interrupt({ proposalId: p.proposalId, agentNames: p.agentNames, totalCredits: p.totalCredits, expiresAt: p.expiresAt });
  const parsed = HitlDecision.safeParse(raw);
  const d: HitlDecision =
    parsed.success && parsed.data.proposalId === p.proposalId ? parsed.data : { proposalId: p.proposalId, decision: "denied", runIds: [] };

  const toolText =
    d.decision === "approved"
      ? `The user APPROVED. Credits held; run ids ${d.runIds.join(", ")}. The user fills the agent's input in the chat card; pressing Run sends it to the marketplace, which runs it in the background. ` +
        "The chat is told automatically when it finishes; do not claim results you have not seen."
      : d.decision === "failed"
        ? `The user confirmed but the run could not start. Reason: ${d.reason ?? "unknown"}. Nothing was held or charged. The user was already told and offered other agents; if they say yes, call find_agents (mode "task") for the same task.`
        : d.decision === "expired"
          ? "The approval expired unanswered. Nothing was held."
        : "The user DENIED the run. Nothing was held. Do not propose it again unless they ask.";
  return {
    messages: [
      new ToolMessage({ content: toolText, tool_call_id: p.toolCallId, name: "propose_run" }),
      new AIMessage(hitlReply(d, p.agentNames, p.totalCredits)),
    ],
    proposal: null,
  };
};
