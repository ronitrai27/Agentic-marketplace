import { pipeClaudeAgentStream, createAgent } from "../src/index.js";

let passed = 0;
let failed = 0;
function assert(condition: boolean, label: string) {
  if (condition) { passed++; console.log(`   ✅ ${label}`); }
  else { failed++; console.log(`   ❌ ${label}`); }
}

const usage = { "claude-haiku-5-5": { inputTokens: 100, outputTokens: 40, cacheReadInputTokens: 10, cacheCreationInputTokens: 5, webSearchRequests: 2, costUSD: 0.01 } };
const result = (extra: Record<string, unknown> = {}) => ({
  type: "result", subtype: "success", total_cost_usd: 0.0123, num_turns: 3, duration_api_ms: 900,
  stop_reason: "end_turn", modelUsage: usage, result: "plain answer", ...extra,
});
const toolUse = (name: string, input: unknown = {}) => ({ type: "assistant", message: { content: [{ type: "tool_use", name, input }] } });

async function* gen(msgs: unknown[]) { for (const m of msgs) yield m; }

async function rejects(p: Promise<unknown>) { try { await p; return null; } catch (e) { return e as Error & { code?: string; retryable?: boolean }; } }

function fakeStream() {
  const events: { type: string; name?: string; text?: string }[] = [];
  const stream: any = {
    progress: (p: number, m?: string) => events.push({ type: "progress", text: m }),
    delta: (t: string) => events.push({ type: "delta", text: t }),
    chunk: () => {}, write: () => {}, step: () => {}, emit: () => {},
    activity: (n: string) => events.push({ type: "activity", name: n }),
    isClosed: () => false,
  };
  return { stream, events };
}

async function main() {
  console.log("🧪 Adapter tests: pipeClaudeAgentStream\n");

  console.log("1️⃣  Structured output + telemetry + events");
  {
    const { stream, events } = fakeStream();
    let usageCb: any;
    const r = await pipeClaudeAgentStream(
      gen([toolUse("WebSearch", { query: "x" }), toolUse("StructuredOutput"), result({ structured_output: { a: 1 } })]),
      stream,
      { parse: (v: any) => ({ ...v, parsed: true }), onUsage: (t) => (usageCb = t) },
    );
    assert((r.output as any).parsed === true && (r.output as any).a === 1, "parse() applied to structured_output");
    assert(r.telemetry?.llm_tokens?.prompt === 115 && r.telemetry?.llm_tokens?.completion === 40, "tokens summed (incl. cache)");
    assert(r.telemetry?.model_used === "claude-haiku-5-5" && r.telemetry?.cost_usd === 0.0123, "model + cost reported");
    assert((r.telemetry?.framework as any).tool_calls.WebSearch === 1, "tool counted");
    assert(!("StructuredOutput" in (r.telemetry?.framework as any).tool_calls), "StructuredOutput hidden from counts");
    assert(events.filter((e) => e.type === "activity").length === 1, "one activity event (internal tool hidden)");
    assert(usageCb?.cost_usd === 0.0123, "onUsage fired");
  }

  console.log("2️⃣  Plain text run (no schema)");
  {
    const { stream, events } = fakeStream();
    const r = await pipeClaudeAgentStream(gen([{ type: "assistant", message: { content: [{ type: "text", text: "hi" }] } }, result()]), stream);
    assert((r.output as any).text === "plain answer", "falls back to { text }");
    assert(events.some((e) => e.type === "delta" && e.text === "hi"), "assistant text streamed as delta");
  }

  console.log("3️⃣  Errors map to Catelog codes");
  {
    const { stream } = fakeStream();
    const rl = await rejects(pipeClaudeAgentStream(gen([{ type: "assistant", error: "rate_limit", message: { content: [] } }, result({ subtype: "error_during_execution" })]), stream));
    assert(rl?.code === "MODEL_RATE_LIMIT" && rl?.retryable === true, "rate_limit → MODEL_RATE_LIMIT (retryable)");
    const bg = await rejects(pipeClaudeAgentStream(gen([result({ subtype: "error_max_budget_usd" })]), stream));
    assert(bg?.code === "BUDGET_EXCEEDED" && bg?.retryable === false, "budget → BUDGET_EXCEEDED (not retryable)");
    const mt = await rejects(pipeClaudeAgentStream(gen([result({ subtype: "error_max_turns" })]), stream));
    assert(mt?.code === "TOOL_FAILURE", "max turns → TOOL_FAILURE");
    const bad = await rejects(pipeClaudeAgentStream(gen([result({ structured_output: { a: 1 } })]), stream, { parse: () => { throw new Error("nope"); } }));
    assert(bad?.code === "INTERNAL_CRASH", "parse failure → INTERNAL_CRASH");
    const none = await rejects(pipeClaudeAgentStream(gen([]), stream));
    assert(none?.code === "INTERNAL_CRASH", "no result → INTERNAL_CRASH");
    let usageOnFail = false;
    await rejects(pipeClaudeAgentStream(gen([result({ subtype: "error_max_turns" })]), stream, { onUsage: () => (usageOnFail = true) }));
    assert(usageOnFail, "onUsage still fires on failure (cost not lost)");
  }

  console.log("4️⃣  Abort signal interrupts the query");
  {
    const { stream } = fakeStream();
    const ac = new AbortController();
    let interrupted = false;
    const q: any = gen([result({ structured_output: {} })]);
    q.interrupt = async () => { interrupted = true; };
    ac.abort();
    await pipeClaudeAgentStream(q, stream, { signal: ac.signal });
    assert(interrupted, "interrupt() called when signal aborted");
  }

  console.log("5️⃣  End to end through createAgent (HTTP)");
  {
    const agent = createAgent({
      name: "Claude E2E",
      async execute({ stream, signal, metric }) {
        return pipeClaudeAgentStream(gen([toolUse("WebSearch"), result({ structured_output: { ok: true } })]), stream, {
          signal,
          onUsage: (t) => metric.gauge("cost_usd", t.cost_usd ?? 0),
        });
      },
    });
    const server = agent.listen({ port: 0, host: "127.0.0.1", silent: true, handleSignals: false });
    await new Promise((r) => server.on("listening", r));
    const port = (server.address() as any).port;
    const res = await (await fetch(`http://127.0.0.1:${port}/execute`, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ input: {} }) })).json();
    assert(res.status === "completed" && res.output.ok === true, "completed with output");
    assert(res.telemetry.cost_usd === 0.0123 && res.telemetry.llm_tokens.total === 155, "telemetry in HTTP response");
    assert(res.telemetry.framework.custom_metrics.cost_usd === 0.0123, "custom metric recorded");
    await agent.shutdown(1000);
    server.close();
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
}
main();
