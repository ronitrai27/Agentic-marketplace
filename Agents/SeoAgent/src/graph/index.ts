import { StateGraph, START, END, MemorySaver } from "@langchain/langgraph";
import { SeoAgentState, type SeoAgentStateType } from "./state.js";
import { guardrailNode, routeAfterGuardrail } from "./nodes/guardrail.node.js";
import { supervisorNode, routeAfterSupervisor } from "./nodes/supervisor.node.js";
import {
  scoutNode,
  routeAfterScout,
  evidenceNode,
  auditNode,
  summaryNode,
} from "./nodes/audit-pipeline.nodes.js";

/**
 * Builds the complete conversational SEO & GEO Intelligence LangGraph.
 */
export function createSeoAgentGraph() {
  const workflow = new StateGraph(SeoAgentState)
    // 1. Add all nodes: guardrail, supervisor & audit pipeline
    .addNode("guardrail", guardrailNode)
    .addNode("supervisor", supervisorNode)
    .addNode("scoutNode", scoutNode)
    .addNode("evidenceNode", evidenceNode)
    .addNode("auditNode", auditNode)
    .addNode("summaryNode", summaryNode)

    // 2. Wire entrypoint: EVERY query must first go through Guardrails!
    .addEdge(START, "guardrail")

    // 3. Conditional routing after Guardrails (Pass -> supervisor, Blocked -> END)
    .addConditionalEdges("guardrail", routeAfterGuardrail, {
      supervisor: "supervisor",
      __end__: END,
    })

    // 4. Wire routing after supervisor
    .addConditionalEdges("supervisor", routeAfterSupervisor, {
      scoutNode: "scoutNode",
      __end__: END,
    })

    // 5. Wire escalation routing
    .addConditionalEdges("scoutNode", routeAfterScout, {
      evidenceNode: "evidenceNode",
      auditNode: "auditNode",
    })

    // 6. Connect pipeline completion
    .addEdge("evidenceNode", "auditNode")
    .addEdge("auditNode", "summaryNode")
    .addEdge("summaryNode", END);

  // Enable conversational memory checkpointer across turns
  const checkpointer = new MemorySaver();

  return workflow.compile({ checkpointer });
}

export { SeoAgentState, type SeoAgentStateType };
