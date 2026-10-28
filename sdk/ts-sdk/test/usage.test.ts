import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import {
  createAgent,
  catelogSpanProcessor,
  createLangChainUsageHandler,
  pipeAiSdkStream,
  pipeOpenAiResponsesStream,
  pipeOpenAiStream,
  NoopStream,
} from "../src/index.js";

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string) {
  if (condition) {
    passed++;
    console.log(`   ✅ ${label}`);
  } else {
    failed++;
    console.log(`   ❌ ${label}`);
  }
}

function start(agent: ReturnType<typeof createAgent>): Promise<{ base: string; server: Server }> {
  return new Promise((resolve) => {
    const server = agent.listen({ port: 0, host: "127.0.0.1", silent: true, handleSignals: false });
    server.on("listening", () => resolve({ base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, server }));
  });
}

async function run(execute: (ctx: any) => Promise<any>) {
  const agent = createAgent({ name: "Usage", maxTimeoutMinute: 1, execute });
  const s = await start(agent);
  const res = await fetch(`${s.base}/execute`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ input: {} }),
  });
  const body = await res.json();
  s.server.close();
  return body;
}

/** Minimal stand-in for an OpenTelemetry span */
function fakeSpan(name: string, attributes: Record<string, unknown>, spanId: string) {
  return { name, attributes, duration: [0, 250_000_000], spanContext: () => ({ spanId }) };
}

console.log("🧪 Usage / telemetry tests\n");

// ─── ctx.usage.record ───
console.log("1️⃣  ctx.usage.record...");
let body = await run(async (ctx) => {
  ctx.usage.record({ model: "gpt-4o", provider: "openai", tokens: { prompt: 100, completion: 20 } });
  ctx.usage.record({ model: "gpt-4o", provider: "openai", tokens: { prompt: 50, completion: 10 } });
  ctx.usage.record({ model: "llama-3.3-70b", provider: "groq", tokens: { prompt: 10, completion: 5 } });
  return { output: { ok: true } };
});
let t = body.telemetry;
assert(t.models.length === 2, "Same model merged, different models kept separate");
const gpt = t.models.find((m: any) => m.id === "gpt-4o");
assert(gpt.calls === 2 && gpt.tokens.prompt === 150 && gpt.tokens.completion === 30 && gpt.tokens.total === 180, "Tokens and calls summed per model");
assert(t.llm_tokens.total === 195 && t.model_used === "gpt-4o,llama-3.3-70b", "Totals + legacy model_used derived");
assert(t.cost_usd === undefined, "No cost invented when none was reported");

body = await run(async (ctx) => {
  ctx.usage.record({ model: "m1", tokens: { prompt: 1 }, costUsd: 0.01 });
  ctx.usage.record({ model: "m2", tokens: { prompt: 1 }, costUsd: 0.02 });
  return { output: {} };
});
assert(body.telemetry.cost_usd === 0.03 && body.telemetry.cost_source === "agent", "Reported cost summed and tagged 'agent'");

body = await run(async (ctx) => {
  ctx.usage.record({ model: "m1", tokens: { prompt: 1 }, costUsd: 0.01 });
  ctx.usage.record({ model: "m1", tokens: { prompt: 1 } }); // second call has no cost
  return { output: {} };
});
assert(body.telemetry.cost_usd === undefined && body.telemetry.models[0].cost_usd === undefined, "Partial cost is dropped instead of understating spend");

body = await run(async (ctx) => {
  ctx.usage.record(undefined as any);
  ctx.usage.record({ model: "" } as any);
  ctx.usage.record({ model: "x", tokens: { prompt: -5, completion: NaN as any }, costUsd: "abc" as any });
  return { output: { ok: 1 } };
});
assert(body.status === "completed", "Garbage usage never crashes the run");

// ─── Failed runs keep their usage ───
console.log("\n2️⃣  Failed runs keep usage...");
body = await run(async (ctx) => {
  ctx.usage.record({ model: "gpt-4o", tokens: { prompt: 7, completion: 3 } });
  throw new Error("boom");
});
assert(body.status === "failed" && body.telemetry?.models?.[0]?.tokens?.total === 10, "Failure response includes models and tokens");

// ─── OpenTelemetry span processor ───
console.log("\n3️⃣  OpenTelemetry span processor...");
body = await run(async () => {
  const outer = fakeSpan("ai.generateText", { "ai.usage.promptTokens": 999, "ai.usage.completionTokens": 999, "ai.model.id": "gpt-4o" }, "s1");
  const inner = fakeSpan(
    "ai.generateText.doGenerate",
    {
      "gen_ai.request.model": "gpt-4o",
      "gen_ai.response.model": "gpt-4o-2024-08-06",
      "gen_ai.system": "openai",
      "gen_ai.usage.input_tokens": 120,
      "gen_ai.usage.output_tokens": 30,
    },
    "s2",
  );
  const agentSpan = fakeSpan("invoke_agent x", { "gen_ai.operation.name": "invoke_agent", "gen_ai.request.model": "gpt-4o", "gen_ai.usage.input_tokens": 500 }, "s3");
  for (const span of [outer, inner, agentSpan]) {
    catelogSpanProcessor.onStart(span);
    await new Promise((r) => setTimeout(r, 5));
    catelogSpanProcessor.onEnd(span);
  }
  return { output: {} };
});
t = body.telemetry;
assert(t.models.length === 1 && t.models[0].id === "gpt-4o-2024-08-06" && t.models[0].provider === "openai", "Only the real LLM call span is counted (parent/agent spans skipped)");
assert(t.models[0].tokens.prompt === 120 && t.models[0].tokens.completion === 30 && t.models[0].latency_ms === 250, "Tokens and latency read from the span");

body = await run(async () => {
  const span = fakeSpan(
    "ai.streamText.doStream",
    { "ai.model.id": "claude-sonnet-5-5", "ai.model.provider": "anthropic.messages", "ai.usage.inputTokens": 40, "ai.usage.outputTokens": 8, "ai.response.providerMetadata": JSON.stringify({ openrouter: { usage: { cost: 0.0042 } } }) },
    "s9",
  );
  catelogSpanProcessor.onStart(span);
  catelogSpanProcessor.onEnd(span);
  return { output: {} };
});
t = body.telemetry;
assert(t.models[0].id === "claude-sonnet-5-5" && t.models[0].provider === "anthropic", "Vercel ai.* attributes understood");
assert(t.cost_usd === 0.0042 && t.cost_source === "provider", "Gateway-reported cost kept as 'provider'");

// span outside a run is ignored without error
catelogSpanProcessor.onEnd(fakeSpan("x", { "gen_ai.request.model": "m" }, "zz"));
assert(true, "Span outside any run ignored");

// ─── LangChain handler ───
console.log("\n4️⃣  LangChain callback handler...");
body = await run(async (ctx) => {
  const h = createLangChainUsageHandler(ctx.usage);
  h.handleChatModelStart({}, [], "r1", undefined, { invocation_params: { model: "gpt-4o-mini" } }, [], { ls_provider: "openai" });
  h.handleLLMEnd({ generations: [[{ message: { usage_metadata: { input_tokens: 11, output_tokens: 4 }, response_metadata: { model_name: "gpt-4o-mini-2024-07-18" } } }]] }, "r1");
  h.handleLLMEnd({ llmOutput: { tokenUsage: { promptTokens: 3, completionTokens: 2 } }, generations: [] }, "r-unknown"); // no model → skipped
  return { output: {} };
});
t = body.telemetry;
assert(t.models.length === 1 && t.models[0].provider === "openai" && t.models[0].tokens.total === 15, "LangChain LLM call captured");

// ─── Adapters ───
console.log("\n5️⃣  Adapters...");
const vercel = await pipeAiSdkStream(
  {
    text: Promise.resolve("hi"),
    textStream: (async function* () { yield "hi"; })(),
    usage: Promise.resolve({ inputTokens: 9, outputTokens: 1, totalTokens: 10 }),
    response: Promise.resolve({ modelId: "gpt-4o" }),
    providerMetadata: Promise.resolve(undefined),
  },
  new NoopStream(),
);
assert(vercel.telemetry?.model_used === "gpt-4o" && vercel.telemetry?.llm_tokens?.total === 10, "Vercel adapter awaits streamText promises and sets the model");

const resp = await pipeOpenAiResponsesStream({ output_text: "x", model: "gpt-5", usage: { input_tokens: 10, output_tokens: 5 } }, new NoopStream());
assert(resp.telemetry?.cost_usd === undefined && resp.telemetry?.model_used === "gpt-5", "Responses adapter no longer fabricates cost");
const resp2 = await pipeOpenAiResponsesStream({ output_text: "x", model: "openai/gpt-5", usage: { input_tokens: 10, output_tokens: 5, cost: 0.002 } }, new NoopStream());
assert(resp2.telemetry?.cost_usd === 0.002 && resp2.telemetry?.cost_source === "provider", "Responses adapter keeps a cost the API returned");

const oa = await pipeOpenAiStream(
  { choices: [{ message: { content: "ok" } }], model: "gpt-4o", usage: { prompt_tokens: 5, completion_tokens: 2, cost: 0.001, prompt_tokens_details: { cached_tokens: 3 } } },
  new NoopStream(),
);
assert(oa.telemetry?.llm_tokens?.cached === 3 && oa.telemetry?.cost_usd === 0.001, "OpenAI adapter reads cached tokens and provider cost");

// adapter → models[] and no double counting with ctx.usage
body = await run(async (ctx) => {
  const r = await pipeOpenAiResponsesStream({ output_text: "x", model: "gpt-5", usage: { input_tokens: 10, output_tokens: 5 } }, ctx.stream);
  return r;
});
assert(body.telemetry.models?.[0]?.id === "gpt-5" && body.telemetry.models[0].tokens.total === 15, "Adapter telemetry becomes models[]");

body = await run(async (ctx) => {
  ctx.usage.record({ model: "gpt-5", tokens: { prompt: 10, completion: 5 } });
  return pipeOpenAiResponsesStream({ output_text: "x", model: "gpt-5", usage: { input_tokens: 10, output_tokens: 5 } }, ctx.stream);
});
assert(body.telemetry.models.length === 1 && body.telemetry.llm_tokens.total === 15, "Adapter + ctx.usage for the same call is not double counted");

console.log(`\n${"─".repeat(50)}`);
if (failed === 0) console.log(`🎉 All ${passed} usage tests passed!`);
else {
  console.log(`⚠️  ${passed} passed, ${failed} failed`);
  process.exit(1);
}
process.exit(0);
