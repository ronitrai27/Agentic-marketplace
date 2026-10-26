import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import {
  createAgent,
  MemoryJobStore,
  RedisJobStore,
  SqliteJobStore,
  type JobStore,
  type StoredJob,
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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function start(agent: ReturnType<typeof createAgent>): Promise<{ base: string; server: Server }> {
  return new Promise((resolve) => {
    const server = agent.listen({ port: 0, host: "127.0.0.1", silent: true, handleSignals: false });
    server.on("listening", () => resolve({ base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, server }));
  });
}

const post = (base: string, body: unknown) =>
  fetch(`${base}/execute`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  });

async function main() {
  console.log("🧪 Feature tests: job stores, limits, shutdown\n");

  // ─── Async job survives an agent "restart" via a shared store ───
  console.log("1️⃣  Async job persisted in a shared store...");
  const store = new MemoryJobStore();
  const a1 = createAgent({
    name: "Async A",
    mode: "async",
    jobStore: store,
    async execute({ stream }) {
      stream.step("working");
      await sleep(50);
      return { output: { ok: true } };
    },
  });
  const s1 = await start(a1);
  const accepted = await (await post(s1.base, { input: {} })).json();
  assert(accepted.status === "working", "202 body says working");
  await sleep(200);
  const done = await (await fetch(`${s1.base}/tasks/${accepted.run_id}`)).json();
  assert(done.status === "completed" && done.output?.ok === true, "Job completes");
  assert(Array.isArray(done.events) && done.events.length > 0, "Events included in poll");
  s1.server.close();

  const a2 = createAgent({ name: "Async B", mode: "async", jobStore: store, async execute() { return {}; } });
  const s2 = await start(a2);
  const afterRestart = await (await fetch(`${s2.base}/tasks/${accepted.run_id}`)).json();
  assert(afterRestart.status === "completed" && afterRestart.output?.ok === true, "New agent instance reads finished job");
  const missing = await fetch(`${s2.base}/tasks/nope`);
  assert(missing.status === 404, "Unknown job -> 404");

  // ─── Stale "working" job from a dead process ───
  console.log("\n2️⃣  Orphaned working job...");
  await store.set({ runId: "dead_1", status: "working", createdAt: Date.now() - 60_000, updatedAt: Date.now() - 60_000 });
  const orphan = await (await fetch(`${s2.base}/tasks/dead_1`)).json();
  assert(orphan.status === "failed" && orphan.error?.code === "TASK_INTERRUPTED", "Reported as TASK_INTERRUPTED");
  assert(orphan.error?.retryable === true, "Marked retryable");
  s2.server.close();

  // ─── Redis adapter with a fake client ───
  console.log("\n3️⃣  Redis + SQLite adapters...");
  const kv = new Map<string, string>();
  const redis = new RedisJobStore({
    get: async (k) => kv.get(k) ?? null,
    set: async (k, v) => void kv.set(k, v),
    expire: async () => 1,
  });
  const job: StoredJob = { runId: "r1", status: "completed", output: { x: 1 }, createdAt: Date.now(), updatedAt: Date.now() };
  await redis.set(job);
  assert((await redis.get("r1"))?.output?.x === 1, "RedisJobStore round-trip");
  assert((await redis.get("zzz")) === undefined, "RedisJobStore miss -> undefined");

  try {
    const sqlite: JobStore = new SqliteJobStore({ path: ":memory:" });
    await sqlite.set(job);
    assert((await sqlite.get("r1"))?.output?.x === 1, "SqliteJobStore round-trip");
    await sqlite.close?.();
  } catch (err) {
    console.log(`   ⏭️  SqliteJobStore skipped (${(err as Error).message})`);
  }

  // ─── Limits ───
  console.log("\n4️⃣  Limits...");
  const open = createAgent({ name: "Open", async execute() { return { ok: 1 }; } });
  const so = await start(open);
  assert((await post(so.base, { input: { pad: "x".repeat(5000) } })).status === 200, "No limits by default");
  so.server.close();

  const limited = createAgent({
    name: "Limited",
    limits: { maxBodyBytes: 200, rateLimit: { max: 3, windowMs: 60_000 } },
    async execute() { return { ok: 1 }; },
  });
  const sl = await start(limited);
  const big = await post(sl.base, { input: { pad: "x".repeat(1000) } });
  assert(big.status === 413, "Oversized body -> 413");
  assert((await big.json()).error.code === "PAYLOAD_TOO_LARGE", "413 has PAYLOAD_TOO_LARGE code");
  const ok = await post(sl.base, { input: {} });
  assert(ok.status === 200, "Small body passes");
  const third = await post(sl.base, { input: {} });
  const fourth = await post(sl.base, { input: {} });
  assert(third.status === 200 && fourth.status === 429, "4th request in window -> 429");
  assert(fourth.headers.get("retry-after") !== null, "429 has Retry-After");
  sl.server.close();

  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const busy = createAgent({
    name: "Busy",
    limits: { maxConcurrent: 1 },
    async execute() { await gate; return { ok: 1 }; },
  });
  const sb = await start(busy);
  const first = post(sb.base, { input: {} });
  await sleep(50);
  const second = await post(sb.base, { input: {} });
  assert(second.status === 429 && (await second.json()).error.code === "SERVER_BUSY", "Over maxConcurrent -> SERVER_BUSY");
  release();
  assert((await first).status === 200, "First request still completes");
  assert((await post(sb.base, { input: {} })).status === 200, "Slot is released afterwards");
  sb.server.close();

  // ─── Graceful shutdown ───
  console.log("\n5️⃣  Graceful shutdown...");
  const slow = createAgent({
    name: "Slow",
    async execute() { await sleep(300); return { output: { done: true } }; },
  });
  const ss = await start(slow);
  const inflight = post(ss.base, { input: {} });
  await sleep(50);
  const t0 = Date.now();
  const shutdown = slow.shutdown(5000);
  const refused = await post(ss.base, { input: {} });
  assert(refused.status === 503 && (await refused.json()).error.code === "SHUTTING_DOWN", "New runs refused while draining");
  const finished = await inflight;
  assert(finished.status === 200 && (await finished.json()).status === "completed", "In-flight run finishes");
  await shutdown;
  assert(Date.now() - t0 < 2000, "Shutdown returns once idle (no full timeout wait)");
  ss.server.close();

  const stuck = createAgent({
    name: "Stuck",
    mode: "async",
    async execute({ signal }) {
      await new Promise((r) => signal.addEventListener("abort", r));
      return {};
    },
  });
  const sk = await start(stuck);
  const acc = await (await post(sk.base, { input: {} })).json();
  await sleep(50);
  await stuck.shutdown(100);
  const killed = await (await fetch(`${sk.base}/tasks/${acc.run_id}`)).json();
  assert(killed.status === "failed" && killed.error?.code === "TASK_INTERRUPTED", "Overdue async job marked TASK_INTERRUPTED");
  sk.server.close();

  console.log(`\n${"─".repeat(50)}`);
  if (failed === 0) console.log(`🎉 All ${passed} feature tests passed!`);
  else {
    console.log(`⚠️  ${passed} passed, ${failed} failed`);
    process.exit(1);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error("❌ Feature tests crashed:", err);
  process.exit(1);
});
