import { StateGraph, START, END } from "@langchain/langgraph";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import { ChefGraphState } from "./state";
import { guardNode, intentNode, refuseNode } from "./guard/node";

/**
 * Checkpointer + compiled graph, built once per server process. `setup()` creates the checkpoint tables
 * (idempotent) the first time; the Postgres pool is async, so it never blocks the event loop.
 */
async function build() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const checkpointer = PostgresSaver.fromConnString(url);
  await checkpointer.setup();

  return new StateGraph(ChefGraphState)
    .addNode("guard", guardNode)
    .addNode("refuse", refuseNode)
    .addNode("understand", intentNode)
    .addEdge(START, "guard")
    .addConditionalEdges("guard", (s) => (s.blocked ? "refuse" : "understand"), ["refuse", "understand"])
    .addEdge("refuse", END)
    .addEdge("understand", END)
    .compile({ checkpointer });
}

let graph: ReturnType<typeof build> | undefined;
export function getChefGraph() {
  graph ??= build().catch((e) => {
    graph = undefined; // retry on the next request
    throw e;
  });
  return graph;
}
