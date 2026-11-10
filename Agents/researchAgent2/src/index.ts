import OpenAI from "openai";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import * as readline from "readline";
import {
  runFast,
  runDeep,
  FAST_MODEL,
  SEARCH_MODEL,
  VERIFY_MODEL,
  FORMAT_MODEL,
  type ResearchEvent,
  type ResearchResult,
} from "./research.js";

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

function printEvent(e: ResearchEvent) {
  const pct = e.percent !== undefined ? ` [${e.percent}%]` : "";
  console.log(`  • ${e.message}${pct}`);
}

function printResult(r: ResearchResult, secs: string) {
  console.log(`
================== RESEARCH RESULT (${secs}s) ==================
`);
  console.log(r.answer);
  console.log(`
===================================================================
`);
}

async function runFastMode(query: string) {
  console.log(`
⚡ [Fast Mode] ${FAST_MODEL} | OpenAI web_search
`);
  const t = Date.now();
  const r = await runFast(client, query, printEvent);
  printResult(r, ((Date.now() - t) / 1000).toFixed(1));
}

async function runDeepMode(query: string) {
  console.log(`
🧠 [Deep Mode] ${SEARCH_MODEL} search → ${VERIFY_MODEL} verify → ${FORMAT_MODEL} report (~3 min)
`);
  const t = Date.now();
  const r = await runDeep(client, query, printEvent);
  printResult(r, ((Date.now() - t) / 1000).toFixed(1));
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
    console.log("  [2] Deep             -> gpt-6-luna search → gpt-4.1-mini verify → gpt-6-luna report (~3 min)");
    mode = await askQuestion("\nChoose mode (1 or 2, default is 1): ");
    if (mode !== "2") mode = "1";
  }

  try {
    if (mode === "1") {
      await runFastMode(query);
    } else {
      await runDeepMode(query);
    }
  } catch (err: any) {
    console.error("\n❌ Error running research agent:", err?.message || err);
  }
}

main();
