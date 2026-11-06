import { StateGraph, START, END } from "@langchain/langgraph";
import type { BaseCheckpointSaver } from "@langchain/langgraph";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import { ChefGraphState } from "./state";
import { finalizeNode, guardNode } from "./guard/node";
import { instantNode } from "./instant/node";

/**
 * Checkpointer + compiled graph, built once per server process. `setup()` creates the checkpoint tables
 * (idempotent) the first time; the Postgres pool is async, so it never blocks the event loop.
 */
/** The graph itself, independent of where checkpoints live (tests pass an in-memory saver). */
export function buildChefGraph(checkpointer: BaseCheckpointSaver) {
  // guard and instant start together; finalize waits for both and keeps or drops the draft
  return new StateGraph(ChefGraphState)
    .addNode("guard", guardNode)
    .addNode("instant", instantNode)
    .addNode("finalize", finalizeNode)
    .addEdge(START, "guard")
    .addEdge(START, "instant")
    .addEdge(["guard", "instant"], "finalize")
    .addEdge("finalize", END)
    .compile({ checkpointer });
}

async function build() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const checkpointer = PostgresSaver.fromConnString(url);
  await checkpointer.setup();

  return buildChefGraph(checkpointer);
}

let graph: ReturnType<typeof build> | undefined;
export function getChefGraph() {
  graph ??= build().catch((e) => {
    graph = undefined; // retry on the next request
    throw e;
  });
  return graph;
}
