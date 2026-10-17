import { StateGraph, Send, START, END } from "@langchain/langgraph";
import { ResearchStateAnnotation, ResearchState } from "./state.js";
import { orchestratorNode } from "./nodes/orchestrator.js";
import { sectionWorkerNode } from "./nodes/worker.js";
import { criticNode } from "./nodes/critic.js";
import { synthesizerNode } from "./nodes/synthesizer.js";

const workflow = new StateGraph(ResearchStateAnnotation)
  // 1. Planning node
  .addNode("orchestrator", orchestratorNode)

  // 2. Worker node executed in parallel for each section
  .addNode("researchSection", sectionWorkerNode)

  // 3. Quality & completeness evaluation
  .addNode("critic", criticNode)

  // 4. Final publication report synthesis
  .addNode("synthesizer", synthesizerNode)

  // Graph wiring:
  .addEdge(START, "orchestrator")

  // Dynamic Parallel Fan-out: Map each section into a parallel worker
  .addConditionalEdges("orchestrator", (state: ResearchState) => {
    if (!state.sections || state.sections.length === 0) {
      return "synthesizer";
    }
    return state.sections.map((section) => new Send("researchSection", { section }));
  })

  // Reduce: all parallel workers route back to the critic node
  .addEdge("researchSection", "critic")

  // Bounded feedback loop
  .addConditionalEdges("critic", (state: ResearchState) => {
    if (state.needsMoreResearch) {
      console.log("[Graph Edge] Looping back to orchestrator for refinement...");
      return "orchestrator";
    }
    console.log("[Graph Edge] Quality gate satisfied. Routing to synthesizer...");
    return "synthesizer";
  })

  .addEdge("synthesizer", END);

export const researchGraph = workflow.compile();
