import OpenAI from "openai";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import * as readline from "readline";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load environment variables from local .env or parent Agents/.env
dotenv.config({ path: path.resolve(__dirname, "../.env") });
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const apiKey = process.env.OPENAI_API_KEY || process.env.OPENAPI_KEY;

if (!apiKey) {
  console.error("❌ Error: OPENAI_API_KEY or OPENAPI_KEY not found in environment or .env file.");
  process.exit(1);
}

const client = new OpenAI({ apiKey });

function askQuestion(query: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(query, (ans) => {
      rl.close();
      resolve(ans.trim());
    });
  });
}

async function runFastMode(query: string) {
  console.log(`\n⚡ [Fast Mode] Model: gpt-6-luna | Web Search enabled`);
  console.log(`🔎 Searching and generating answer...\n`);

  const startTime = Date.now();
  const response = await client.responses.create({
    model: "gpt-6-luna",
    input: query,
    tools: [{ type: "web_search" }],
  });

  const duration = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n================== RESEARCH RESULT (${duration}s) ==================\n`);
  console.log(response.output_text);
  console.log(`\n===================================================================\n`);
}

async function runHighEfficiencyMode(query: string) {
  console.log(`\n🧠 [High Efficiency Deep Mode] Model: gpt-5.4-mini | reasoning: { effort: 'medium' } | background: true | Web Search enabled`);
  console.log(`🚀 Dispatching background research task...\n`);

  const startTime = Date.now();
  let response = await client.responses.create({
    model: "gpt-5.4-mini",
    input: query,
    background: true,
    reasoning: { effort: "medium" },
    tools: [{ type: "web_search" }],
  });

  console.log(`📋 Task ID: ${response.id} | Initial Status: ${response.status}`);

  // Polling loop as documented in OpenAI Background mode guide
  let dots = 0;
  while (response.status === "queued" || response.status === "in_progress") {
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    const indicator = ".".repeat((dots % 3) + 1);
    process.stdout.write(`\r⏳ Status: [${response.status}] ${elapsed}s elapsed ${indicator}   `);
    dots++;
    await new Promise((resolve) => setTimeout(resolve, 2000));
    response = await client.responses.retrieve(response.id);
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(1);
  process.stdout.write(`\r✅ Final Status: [${response.status}] completed in ${duration}s                  \n\n`);

  if (response.status === "completed") {
    console.log(`================== RESEARCH RESULT (${duration}s) ==================\n`);
    console.log(response.output_text);
    console.log(`\n===================================================================\n`);
  } else {
    console.error(`❌ Background request ended with status: ${response.status}`);
  }
}

async function main() {
  console.log("=================================================");
  console.log("          🌐 Research Agent 2 (OpenAI SDK)        ");
  console.log("=================================================");

  const args = process.argv.slice(2);
  let query = "";
  let mode = "";

  if (args.length > 0) {
    query = args[0];
    if (args[1]) {
      mode = args[1].toLowerCase().includes("fast") || args[1] === "1" ? "1" : "2";
    }
  }

  if (!query) {
    query = await askQuestion("📝 Enter your research question / topic: ");
    if (!query) {
      console.log("No query entered. Exiting.");
      return;
    }
  }

  if (!mode) {
    console.log("\nSelect Mode:");
    console.log("  [1] Fast Mode        -> gpt-6-luna (immediate web search response)");
    console.log("  [2] High Efficiency  -> gpt-5.4-mini (background=true, reasoning effort: medium)");
    mode = await askQuestion("\nChoose mode (1 or 2, default is 1): ");
    if (mode !== "2") mode = "1";
  }

  try {
    if (mode === "1") {
      await runFastMode(query);
    } else {
      await runHighEfficiencyMode(query);
    }
  } catch (err: any) {
    console.error("\n❌ Error running research agent:", err?.message || err);
  }
}

main();
