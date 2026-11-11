import type { AddressInfo } from "node:net";
import { createAgent } from "../src/index.js";

let failed = 0;
function assert(ok: boolean, label: string) {
  if (!ok) failed++;
  console.log(`   ${ok ? "✅" : "❌"} ${label}`);
}

async function main() {
  console.log("🧪 stream.step() keeps the last percent\n");
  const agent = createAgent({
    maxTimeoutMinute: 1,
    name: "Step test",
    async execute({ stream }) {
      stream.step("before any progress"); // 0
      stream.progress(40, "forty");
      stream.step("relabel"); // must stay 40
      stream.progress(70, "seventy");
      stream.step("relabel again"); // must stay 70
      return { output: { ok: true } };
    },
  });
  const server = agent.listen({ port: 0, host: "127.0.0.1", silent: true, handleSignals: false });
  await new Promise<void>((r) => server.on("listening", () => r()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const res = await fetch(`${base}/execute`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify({ input: {} }),
  });
  const text = await res.text();
  const percents = [...text.matchAll(/event: task\.progress\ndata: (.*)\n/g)].map((m) => JSON.parse(m[1]).percent);
  assert(JSON.stringify(percents) === JSON.stringify([0, 40, 40, 70, 70]), `percents never go backwards: ${JSON.stringify(percents)}`);
  assert(text.includes("event: task.completed"), "run completes");
  server.close();

  if (failed) {
    console.log(`\n❌ ${failed} failed`);
    process.exit(1);
  }
  console.log("\n✅ passed");
}

main();
