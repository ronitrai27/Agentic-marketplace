import { z } from "zod";
import { createMarketplaceAgent } from "../src/index.js";
import { SecurityManager } from "../src/security.js";

async function runTests() {
  console.log("🧪 Starting catelog SDK test suite...\n");

  const InputSchema = z.object({
    query: z.string().min(3),
    targetCount: z.number().default(5),
  });

  const OutputSchema = z.object({
    results: z.array(z.string()),
    count: z.number(),
  });

  const agentSecret = "test-secret-key-1234567890";

  // 1. Initialize Agent
  const agent = createMarketplaceAgent({
    name: "Test Research Agent",
    version: "1.0.0",
    description: "An agent for automated testing",
    secret: agentSecret,
    inputSchema: InputSchema,
    outputSchema: OutputSchema,
    async execute({ input, stream }) {
      stream.step("Searching data for: " + input.query);
      stream.delta("Result 1: " + input.query);
      return {
        output: {
          results: [`Item 1 for ${input.query}`, `Item 2 for ${input.query}`],
          count: 2,
        },
        telemetry: {
          model_used: "gpt-4o-mini",
          llm_tokens: { prompt: 100, completion: 50, total: 150 },
          cost_usd: 0.0015,
        },
      };
    },
  });

  // Test 1: Health Check
  console.log("1️⃣ Testing /health response...");
  const health = agent.getHealth();
  if (health.status !== "ready" || health.protocol_version !== "1.0.0") {
    throw new Error(`Health check failed: ${JSON.stringify(health)}`);
  }
  console.log("   ✅ Health check passed: status=ready, version=" + health.protocol_version);

  // Test 2: Schema Manifest
  console.log("2️⃣ Testing /schema manifest generation...");
  const manifest = agent.getManifest();
  if (manifest.id !== "test-research-agent" || !manifest.input_schema || !manifest.output_schema) {
    throw new Error(`Manifest verification failed: ${JSON.stringify(manifest)}`);
  }
  console.log("   ✅ Schema manifest passed: id=" + manifest.id);

  // Test 3: HMAC Canonical Signing & Verification
  console.log("3️⃣ Testing HMAC-SHA256 signature verification...");
  const security = new SecurityManager({ secret: agentSecret });
  const runId = "run_" + Math.random().toString(36).substring(2, 10);
  const nonce = "nonce_" + Math.random().toString(36).substring(2, 10);
  const timestamp = Date.now();
  const rawBody = JSON.stringify({
    run_id: runId,
    input: { query: "Fintech startups in Austin", targetCount: 10 },
  });

  const bodyHash = security.computeBodyHash(rawBody);
  const canonicalString = security.buildCanonicalString("POST", "/execute", timestamp, nonce, runId, bodyHash);
  const validSignature = security.calculateSignature(canonicalString, agentSecret);

  // Verify should succeed
  const verified = agent.security.verifyRequest({
    method: "POST",
    path: "/execute",
    headers: {
      "x-marketplace-protocol": "1.0.0",
      "x-marketplace-timestamp": String(timestamp),
      "x-marketplace-nonce": nonce,
      "x-marketplace-run-id": runId,
      "x-marketplace-signature": validSignature,
    },
    rawBody,
  });

  if (verified.runId !== runId) {
    throw new Error(`Verification failed, runId mismatch: ${verified.runId}`);
  }
  console.log("   ✅ Valid signature verified successfully!");

  // Test 4: Replay attack guard (same nonce)
  console.log("4️⃣ Testing anti-replay nonce protection...");
  try {
    agent.security.verifyRequest({
      method: "POST",
      path: "/execute",
      headers: {
        "x-marketplace-protocol": "1.0.0",
        "x-marketplace-timestamp": String(timestamp),
        "x-marketplace-nonce": nonce, // Duplicate!
        "x-marketplace-run-id": "run_other",
        "x-marketplace-signature": validSignature,
      },
      rawBody,
    });
    throw new Error("Replay guard failed to reject duplicate nonce!");
  } catch (err: any) {
    if (err.code === "AUTH_REPLAY_DETECTED") {
      console.log("   ✅ Duplicate nonce successfully blocked with AUTH_REPLAY_DETECTED!");
    } else {
      throw err;
    }
  }

  // Test 5: Invalid signature rejection
  console.log("5️⃣ Testing tampered signature rejection...");
  try {
    agent.security.verifyRequest({
      method: "POST",
      path: "/execute",
      headers: {
        "x-marketplace-protocol": "1.0.0",
        "x-marketplace-timestamp": String(timestamp),
        "x-marketplace-nonce": "nonce_new_" + Date.now(),
        "x-marketplace-run-id": "run_new_" + Date.now(),
        "x-marketplace-signature": "tampered_bad_signature_hex",
      },
      rawBody,
    });
    throw new Error("Security failed to reject bad signature!");
  } catch (err: any) {
    if (err.code === "AUTH_INVALID_SIGNATURE") {
      console.log("   ✅ Tampered signature successfully rejected with AUTH_INVALID_SIGNATURE!");
    } else {
      throw err;
    }
  }

  console.log("\n🎉 All catelog SDK tests passed successfully!");
}

runTests().catch((err) => {
  console.error("❌ Test suite failed:", err);
  process.exit(1);
});
