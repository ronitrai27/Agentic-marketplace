import { StateGraph, START, END, MemorySaver } from "@langchain/langgraph";
import type { BaseCheckpointSaver } from "@langchain/langgraph";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import { ChefGraphState } from "./state";
import { finalizeNode, guardNode } from "./guard/node";
import { instantNode } from "./instant/node";
import { heavyNode } from "./heavy/node";
import { hitlNode } from "./hitl/node";

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
    .addNode("heavy", heavyNode)
    .addNode("hitl", hitlNode)
    .addEdge(START, "guard")
    .addEdge(START, "instant")
    .addEdge(["guard", "instant"], "finalize")
    // refused or chit-chat turns end here; tasks go on to the tool-using model
    .addConditionalEdges("finalize", (s) => (s.blocked || s.modelKind === "instant" ? END : "heavy"), ["heavy", END])
    // a run proposal pauses in hitl (interrupt) until the human approves or denies
    .addConditionalEdges("heavy", (s) => (s.proposal ? "hitl" : END), ["hitl", END])
    .addEdge("hitl", END)
    .compile({ checkpointer });
}

/** How long Postgres gets to answer before the chef falls back to memory. */
const PG_CONNECT_TIMEOUT_MS = 6_000;

async function build() {
  const url = process.env.DATABASE_URL;
  if (url) {
    const checkpointer = PostgresSaver.fromConnString(url);
    try {
      await Promise.race([
        checkpointer.setup(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`Postgres did not answer in ${PG_CONNECT_TIMEOUT_MS}ms`)), PG_CONNECT_TIMEOUT_MS),
        ),
      ]);
      return buildChefGraph(checkpointer);
    } catch (e) {
      checkpointer.end().catch(() => {});
      console.error("[chef] Postgres checkpointer unreachable, using in-memory checkpoints:", e instanceof Error ? e.message : e);
    }
  } else {
    console.error("[chef] DATABASE_URL is not set, using in-memory checkpoints");
  }
  // Fallback: chats keep working, but paused approvals and thread memory are lost on a server restart.
  // The chat history the UI shows lives in Convex, so it is not affected.
  return buildChefGraph(new MemorySaver());
}

let graph: ReturnType<typeof build> | undefined;
export function getChefGraph() {
  graph ??= build().catch((e) => {
    graph = undefined; // retry on the next request
    throw e;
  });
  return graph;
}
