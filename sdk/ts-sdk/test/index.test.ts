import { z } from "zod";
import { createAgent, createMarketplaceAgent } from "../src/index.js";
import { SecurityManager } from "../src/security.js";

async function runTests() {
  console.log("🧪 Starting catelog SDK test suite (v2 — refined architecture)...\n");

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

  // ─── Test 1: Minimal Agent (Zero Config) ───
  console.log("1️⃣  Minimal agent — no schema, no keys, just execute...");
  const minimalAgent = createAgent({
    name: "Minimal Agent",
    async execute({ input }) {
      return { greeting: `Hello, ${(input as any).name || "world"}!` };
    },
  });

  const health = minimalAgent.getHealth();
  assert(health.status === "ready", "Health status = ready");
  assert(health.protocol_version === "1.0.0", "Protocol version = 1.0.0");
  assert(health.capabilities?.execution_modes?.includes("sync") === true, "Capabilities include sync mode");
  assert(typeof health.uptime_seconds === "number", "Uptime is a number");

  const manifest = minimalAgent.getManifest();
  assert(manifest.id === "minimal-agent", "Auto-slugified ID = minimal-agent");
  assert(manifest.input_schema?.type === "object", "Input schema defaults to { type: object }");
  assert(manifest.output_schema?.type === "object", "Output schema defaults to { type: object }");

  // ─── Test 2: Agent with Zod Schemas ───
  console.log("\n2️⃣  Agent with Zod schemas...");
  const InputSchema = z.object({
    query: z.string().min(3),
    targetCount: z.number().default(5),
  });

  const OutputSchema = z.object({
    results: z.array(z.string()),
    count: z.number(),
  });

  const schemaAgent = createAgent({
    name: "Schema Agent",
    inputSchema: InputSchema,
    outputSchema: OutputSchema,
    async execute({ input }) {
      return {
        output: {
          results: [`Result for ${input.query}`],
          count: 1,
        },
        telemetry: {
          model_used: "gpt-4o-mini",
          llm_tokens: { prompt: 100, completion: 50, total: 150 },
        },
      };
    },
  });

  const schemaManifest = schemaAgent.getManifest();
  assert(!!schemaManifest.input_schema.properties, "Input schema has properties from Zod");
  assert(schemaManifest.id === "schema-agent", "Schema agent ID correct");

  // ─── Test 3: Backward Compatibility (createMarketplaceAgent) ───
  console.log("\n3️⃣  Backward compat — createMarketplaceAgent still works...");
  const legacyAgent = createMarketplaceAgent({
    name: "Legacy Agent",
    async execute({ input, stream }) {
      stream.step("Processing");
      stream.delta("Hello");
      return { output: { done: true } };
    },
  });
  assert(legacyAgent.name === "Legacy Agent", "Legacy factory creates agent correctly");

  // ─── Test 4: Dual-Mode Security — Bearer Auth ───
  console.log("\n4️⃣  Dual-mode security — Bearer token auth...");
  const secretKey = "cat_sec_live_test123456789abcdef";
  const securityAgent = createAgent({
    name: "Secure Agent",
    secretKey,
    async execute({ input }) {
      return { secure: true };
    },
  });

  // Valid Bearer token
  const bearerResult = securityAgent.security.authenticateRequest({
    method: "POST",
    path: "/execute",
    headers: { authorization: `Bearer ${secretKey}` },
    rawBody: Buffer.from("{}"),
  });
  assert(bearerResult.authMode === "bearer", "Bearer auth mode detected");
  assert(typeof bearerResult.runId === "string", "RunId generated for Bearer");

  // Invalid Bearer token
  try {
    securityAgent.security.authenticateRequest({
      method: "POST",
      path: "/execute",
      headers: { authorization: "Bearer cat_sec_live_wrongkey999999" },
      rawBody: Buffer.from("{}"),
    });
    assert(false, "Invalid Bearer should have thrown");
  } catch (err: any) {
    assert(err.code === "AUTH_INVALID_KEY", "Invalid Bearer rejected with AUTH_INVALID_KEY");
  }

  // ─── Test 5: Dual-Mode Security — HMAC Auth ───
  console.log("\n5️⃣  Dual-mode security — HMAC-SHA256 auth...");
  const hmacSecret = "test-hmac-secret-key-1234567890";
  const security = new SecurityManager({ secret: hmacSecret });

  const runId = "run_" + Math.random().toString(36).substring(2, 10);
  const nonce = "nonce_" + Math.random().toString(36).substring(2, 10);
  const timestamp = Date.now();
  const rawBody = JSON.stringify({ run_id: runId, input: { query: "test" } });

  const bodyHash = security.computeBodyHash(rawBody);
  const canonical = security.buildCanonicalString("POST", "/execute", timestamp, nonce, runId, bodyHash);
  const signature = security.calculateSignature(canonical, hmacSecret);

  const hmacResult = security.authenticateRequest({
    method: "POST",
    path: "/execute",
    headers: {
      "x-marketplace-timestamp": String(timestamp),
      "x-marketplace-nonce": nonce,
      "x-marketplace-run-id": runId,
      "x-marketplace-signature": signature,
    },
    rawBody,
  });
  assert(hmacResult.authMode === "hmac", "HMAC auth mode detected");
  assert(hmacResult.runId === runId, "HMAC returns correct runId");

  // ─── Test 6: Anti-Replay (Duplicate Nonce) ───
  console.log("\n6️⃣  Anti-replay — duplicate nonce protection...");
  try {
    security.authenticateRequest({
      method: "POST",
      path: "/execute",
      headers: {
        "x-marketplace-timestamp": String(timestamp),
        "x-marketplace-nonce": nonce, // Same nonce!
        "x-marketplace-run-id": "run_other",
        "x-marketplace-signature": signature,
      },
      rawBody,
    });
    assert(false, "Replay should have been detected");
  } catch (err: any) {
    assert(err.code === "AUTH_REPLAY_DETECTED", "Duplicate nonce blocked with AUTH_REPLAY_DETECTED");
  }

  // ─── Test 7: Dev Mode (No Keys) ───
  console.log("\n7️⃣  Dev mode — no keys, permissive...");
  const originalEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "development";
  const devSecurity = new SecurityManager(); // No keys

  const devResult = devSecurity.authenticateRequest({
    method: "POST",
    path: "/execute",
    headers: {},
    rawBody: Buffer.from("{}"),
  });
  assert(devResult.authMode === "dev", "Dev mode detected when no keys");
  assert(typeof devResult.runId === "string", "Dev mode generates runId");
  process.env.NODE_ENV = originalEnv;

  // ─── Test 8: Execution Modes ───
  console.log("\n8️⃣  Execution modes — sync, async, conversational...");
  const syncAgent = createAgent({ name: "Sync", async execute() { return { ok: true }; } });
  assert(syncAgent.mode === "sync", "Default mode is sync");

  const asyncAgent = createAgent({ name: "Async", mode: "async", async execute() { return { ok: true }; } });
  assert(asyncAgent.mode === "async", "Async mode set correctly");
  assert(asyncAgent.capabilities.execution_modes.includes("async"), "Capabilities include async");

  const convAgent = createAgent({ name: "Conv", mode: "conversational", async execute() { return { ok: true }; } });
  assert(convAgent.mode === "conversational", "Conversational mode set correctly");

  // ─── Test 9: Health Check includes capabilities ───
  console.log("\n9️⃣  Health check includes capabilities for registration probe...");
  const richHealth = asyncAgent.getHealth();
  assert(!!richHealth.capabilities, "Health response includes capabilities");
  assert(richHealth.capabilities!.execution_modes.includes("async"), "Health shows async in capabilities");

  // ─── Test 10: Public Key Auth ───
  console.log("\n🔟 Public key auth (cat_pub_live_...)...");
  const pubKey = "cat_pub_live_testpublickey123456";
  const pubSecurity = new SecurityManager({ publicKey: pubKey });

  const pubResult = pubSecurity.authenticateRequest({
    method: "GET",
    path: "/schema",
    headers: { authorization: `Bearer ${pubKey}` },
    rawBody: Buffer.from(""),
  });
  assert(pubResult.authMode === "public", "Public key auth mode detected");

  // ─── Summary ───
  console.log(`\n${"─".repeat(50)}`);
  if (failed === 0) {
    console.log(`🎉 All ${passed} tests passed!`);
  } else {
    console.log(`⚠️  ${passed} passed, ${failed} failed`);
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error("❌ Test suite crashed:", err);
  process.exit(1);
});
