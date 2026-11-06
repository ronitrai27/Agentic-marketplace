// Latency test for the instant model: does turning reasoning off make it answer faster?
// Run: pnpm chef:bench-instant
import { INSTANT_SYSTEM_PROMPT } from "./prompt";

const key = process.env.OPENAI_API_KEY ?? process.env.OPENAPI_KEY;
const model = process.env.GPT_INSTANT_MODEL ?? "gpt-6-luna";
if (!key) throw new Error("OPENAI_API_KEY is not set");

type Variant = { name: string; effort?: string };
const VARIANTS: Variant[] = [
  { name: "reasoning default" },
  { name: "reasoning off (effort none)", effort: "none" },
  { name: "reasoning low", effort: "low" },
];
const PROMPTS = ["hello", "what is catelog?", "how does payment work?"];

async function once(prompt: string, v: Variant) {
  const t0 = performance.now();
  let ttft = 0;
  let text = "";
  let usage: any = null;
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      stream: true,
      stream_options: { include_usage: true },
      max_completion_tokens: 300,
      messages: [{ role: "system", content: INSTANT_SYSTEM_PROMPT }, { role: "user", content: prompt }],
      ...(v.effort ? { reasoning_effort: v.effort } : {}),
    }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data: ") || line.includes("[DONE]")) continue;
      const j = JSON.parse(line.slice(6));
      const delta = j.choices?.[0]?.delta?.content;
      if (delta) {
        if (!ttft) ttft = performance.now() - t0;
        text += delta;
      }
      if (j.usage) usage = j.usage;
    }
  }
  return { ttft: Math.round(ttft), total: Math.round(performance.now() - t0), text, reasoningTokens: usage?.completion_tokens_details?.reasoning_tokens ?? 0, out: usage?.completion_tokens ?? 0 };
}

console.log(`model: ${model}\n`);
for (const v of VARIANTS) {
  const rows = [];
  for (const p of PROMPTS) {
    try {
      const r = await once(p, v);
      rows.push(r);
      console.log(`${v.name.padEnd(30)} "${p}"`.padEnd(66), `ttft ${String(r.ttft).padStart(5)}ms  total ${String(r.total).padStart(5)}ms  reasoning_tokens ${r.reasoningTokens}  out ${r.out}`);
    } catch (e) {
      console.log(`${v.name.padEnd(30)} "${p}"`.padEnd(66), "ERROR", (e as Error).message);
    }
  }
  if (rows.length) console.log(`  -> avg ttft ${Math.round(rows.reduce((a, r) => a + r.ttft, 0) / rows.length)}ms | sample: ${rows[0].text.slice(0, 110).replace(/\n/g, " ")}\n`);
}
