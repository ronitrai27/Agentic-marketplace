import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { HumanMessage } from "@langchain/core/messages";
import { createSeoAgentGraph } from "./graph/index.js";

async function startCliChat() {
  console.clear();
  console.log("================================================================================");
  console.log("       🌐 ENTERPRISE SEO & GEO INTELLIGENCE PLATFORM — INTERACTIVE CLI         ");
  console.log("================================================================================");
  console.log("  • Guardrail-First Protection: In-memory banlist + PII Sanitizer + JEV Safety");
  console.log("  • Autonomous 5-Pillar Diagnostics: Static Crawl -> JEV Gate -> Browserbase Proof");
  console.log("  • Conversational Memory: Threaded multi-turn memory via LangGraph MemorySaver");
  console.log("  • Commands: Type 'exit' or 'quit' to terminate the session.");
  console.log("================================================================================\n");

  const app = createSeoAgentGraph();
  const threadId = `cli-session-${Date.now()}`;
  const config = { configurable: { thread_id: threadId } };

  const rl = readline.createInterface({ input, output });

  console.log(`💡 Session initialized [Thread ID: ${threadId}]`);
  console.log("Ask general SEO questions, provide a URL to audit (e.g., 'Audit https://example.com'), or query audit findings.\n");

  try {
    while (true) {
      const userInput = await rl.question("\n👤 You: ");
      const trimmed = userInput.trim();

      if (!trimmed) {
        continue;
      }

      if (trimmed.toLowerCase() === "exit" || trimmed.toLowerCase() === "quit") {
        console.log("\n👋 Exiting SEO Agent CLI. Have a productive day!\n");
        break;
      }

      console.log("\n--- Processing Pipeline ---");
      try {
        const result = await app.invoke(
          {
            messages: [new HumanMessage(trimmed)],
          },
          config
        );

        const latestMessage = result.messages[result.messages.length - 1];
        console.log("---------------------------\n");
        console.log(`🤖 Agent:\n${latestMessage?.content ?? "No response generated."}\n`);
      } catch (err: any) {
        console.log("---------------------------\n");
        console.error(`❌ Error during query processing: ${err.message || String(err)}\n`);
      }
    }
  } finally {
    rl.close();
  }
}

startCliChat().catch((err) => {
  console.error("Fatal CLI Error:", err);
  process.exit(1);
});
