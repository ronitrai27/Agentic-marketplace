import { classify, answerDirect } from "./index.js";

async function main() {
  console.log("\n=======================================================");
  console.log("🧪 TEST 1: Conversational Chit-Chat (Groq Direct)");
  console.log("=======================================================");
  const chitChatPrompt = "hello good morning !!";
  const start1 = Date.now();
  const guard1 = await classify(chitChatPrompt);
  console.log(`Guardrail decision: needsResearch = ${guard1.needsResearch}, isAllowed = ${guard1.isAllowed}`);
  
  if (!guard1.needsResearch) {
    console.log("⚡ Routing directly to Groq (no background worker called)...");
    const result1 = await answerDirect(chitChatPrompt, { scores: guard1.scores });
    console.log(`⏱️ Duration: ${Date.now() - start1}ms`);
    console.log(`Outcome Status: ${result1.status}`);
    console.log(`Answer:\n${result1.answer}\n`);
  }

  console.log("\n=======================================================");
  console.log("🧪 TEST 2: Deep Research Prompt Classification");
  console.log("=======================================================");
  const researchPrompt = "Compare Solid-State Batteries vs Lithium-Ion for commercial aviation in 2025";
  const start2 = Date.now();
  const guard2 = await classify(researchPrompt);
  console.log(`Guardrail decision: needsResearch = ${guard2.needsResearch}, isAllowed = ${guard2.isAllowed}`);
  console.log(`⏱️ Duration: ${Date.now() - start2}ms`);
  console.log(`Route: ${guard2.needsResearch ? "DISPATCH TO TEMPORAL WORKFLOW" : "DIRECT GROQ"}`);
}

main().catch(console.error);
