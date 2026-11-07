// Run: npx tsx --env-file=.env.local src/chef/heavy/test-reasoning.mts
// Does the heavy model stream a reasoning summary, and how much time do we save by running the tool
// speculatively (on the user's text) while the model is still reasoning?
// The tool here is the real Typesense search (no Convex enrich: that needs a user token), so its timing is a floor.
import { ChatOpenAI } from "@langchain/openai";
import { tool } from "@langchain/core/tools";
import { AIMessage, HumanMessage, SystemMessage, ToolMessage, type AIMessageChunk } from "@langchain/core/messages";
import { HEAVY_SYSTEM_PROMPT } from "./prompt";
import { FindAgentsArgs } from "../tools/find-agents";
import { searchClient } from "@/lib/typesense";
import { searchAgents } from "@/lib/agent-search";

const client = searchClient();
if (!client) throw new Error("Typesense env missing");

async function runSearch(query: string) {
  const t = performance.now();
  const r = await searchAgents(client!, query, { exact: 4, related: 10, similar: 3 });
  const names = [...r.exact, ...r.related, ...r.similar].map((h) => h.name).slice(0, 6);
  return { names, ms: Math.round(performance.now() - t), text: names.length ? `Found: ${names.join(", ")}` : `No active agent matched "${query}".` };
}

const findAgents = tool(async () => "", { name: "find_agents", description: "Find agents by task or name.", schema: FindAgentsArgs });
const model = new ChatOpenAI({
  model: process.env.GPT_HEAVY_MODEL!,
  apiKey: process.env.OPENAI_API_KEY ?? process.env.OPENAPI_KEY,
  streaming: true,
  useResponsesApi: true,
  reasoning: { effort: (process.env.EFFORT ?? "low") as "low" | "medium" | "high", summary: "auto" },
}).bindTools([findAgents]);

type Ev = { at: number; what: string };

async function stream(msgs: any[], t0: number, ev: Ev[], tag: string) {
  let full: AIMessageChunk | undefined;
  let reasoning = "";
  let firstR = 0;
  let firstText = 0;
  for await (const chunk of await model.stream(msgs)) {
    full = full ? full.concat(chunk) : chunk;
    const c = chunk.content;
    const blocks = typeof c === "string" ? [{ type: "text", text: c }] : (c as any[]);
    for (const b of blocks) {
      if (b.type === "reasoning" && b.reasoning) {
        if (!firstR) { firstR = performance.now() - t0; ev.push({ at: firstR, what: `${tag} first reasoning token` }); }
        reasoning += b.reasoning;
      }
      if (b.type === "text" && b.text && !firstText) { firstText = performance.now() - t0; ev.push({ at: firstText, what: `${tag} first answer token` }); }
    }
    if (chunk.tool_call_chunks?.length && !ev.some((e) => e.what === `${tag} tool call started`)) ev.push({ at: performance.now() - t0, what: `${tag} tool call started` });
  }
  return { full: full!, reasoning };
}

async function scenario(label: string, text: string, speculative: boolean) {
  const t0 = performance.now();
  const ev: Ev[] = [];
  const base = [new SystemMessage(HEAVY_SYSTEM_PROMPT), new HumanMessage(text)];

  // speculative: start the search the moment the request arrives, on the user's own words
  if (speculative) ev.push({ at: 0, what: `tool card shown EARLY: find_agents(${JSON.stringify(text)}) running` });
  const spec = speculative ? runSearch(text).then((r) => { ev.push({ at: performance.now() - t0, what: `speculative search done (${r.ms}ms)` }); return r; }) : null;

  const s1 = await stream(base, t0, ev, "step1");
  ev.push({ at: performance.now() - t0, what: "step1 stream ended" });
  const call = s1.full.tool_calls?.[0];
  let final = s1.full.text ?? "";
  let toolMs = 0;
  let reused = false;
  if (call) {
    const wanted = String((call.args as any).query ?? "");
    ev.push({ at: performance.now() - t0, what: `tool card shown: find_agents(${JSON.stringify(call.args)})` });
    let res;
    if (spec) {
      res = await spec;
      reused = true; // used as-is when the model's query is close to the user's text; checked below
      const tok = (x: string) => x.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(Boolean);
      const userTok = new Set(tok(text));
      // reuse when the model only trimmed the user's words ("research agent" from "I need a research agent")
      const sameAsk = tok(wanted).every((w) => userTok.has(w));
      if (!sameAsk) {
        // the model rephrased: the speculative result is still a good draft, but a real run is the safe path
        const real = await runSearch(wanted);
        ev.push({ at: performance.now() - t0, what: `model rephrased the query, re-ran search (${real.ms}ms)` });
        res = real;
        reused = false;
      }
    } else {
      res = await runSearch(wanted);
    }
    toolMs = res.ms;
    ev.push({ at: performance.now() - t0, what: `tool result ready${reused ? " (reused speculative)" : ""}` });
    const s2 = await stream(
      [...base, new AIMessage({ content: "", tool_calls: s1.full.tool_calls }), new ToolMessage({ content: res.text, tool_call_id: call.id!, name: "find_agents" })],
      t0, ev, "step2",
    );
    final = s2.full.text ?? "";
  }
  const total = Math.round(performance.now() - t0);
  console.log(`\n=== ${label} | "${text}" | ${speculative ? "SPECULATIVE tool" : "SEQUENTIAL tool"} ===`);
  console.log(`reasoning summary (${s1.reasoning.length} chars): ${s1.reasoning ? JSON.stringify(s1.reasoning.slice(0, 220)) : "(none)"}`);
  for (const e of ev.sort((a, b) => a.at - b.at)) console.log(`  ${String(Math.round(e.at)).padStart(6)}ms  ${e.what}`);
  console.log(`  total ${total}ms${toolMs ? `  (tool ${toolMs}ms)` : ""}\n  answer: ${final.slice(0, 160).replace(/\n/g, " ")}`);
  return total;
}

const queries = ["I need a research agent", "Nova research"];
for (const q of queries) {
  try {
    const a = await scenario("A", q, false);
    const b = await scenario("B", q, true);
    console.log(`>>> saved by speculative: ${a - b}ms for "${q}"`);
  } catch (e) {
    console.error("FAILED:", e instanceof Error ? e.message : e);
  }
}
