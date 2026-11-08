import { interrupt, type GraphNode } from "@langchain/langgraph";
import { AIMessage, ToolMessage } from "@langchain/core/messages";
import { ChefGraphState, HitlDecision } from "../state";

/** The fixed reply for each answer. No model call: the facts are known and nothing here should be reworded. */
export function hitlReply(d: HitlDecision, names: string[], credits: number): string {
  const who = names.join(" and ");
  if (d.decision === "approved") {
    return (
      `Approved. ${credits} credits are held for ${who} and ${names.length > 1 ? "they are" : "it is"} open in the side sheet: ` +
      `give the input there and press Run. ${names.length > 1 ? "They run" : "It runs"} in the background, so keep asking me anything; ` +
      "I'll post here as soon as the output is ready."
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
      ? `The user APPROVED. Credits held; run ids ${d.runIds.join(", ")}. The agent opened in the side sheet for its input and runs in the background. ` +
        "The chat is told automatically when it finishes; do not claim results you have not seen."
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
