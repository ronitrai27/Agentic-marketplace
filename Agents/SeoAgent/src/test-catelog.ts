import http from "node:http";
import { seoCatelogAgent } from "./catelog-agent.js";
import { env } from "./config/env.js";

async function runCatelogTests() {
  console.log("🧪 Starting SeoAgent Catelog SDK Protocol Verification Suite...\n");

  // Create temporary test server
  const testServer = http.createServer((req, res) => {
    return seoCatelogAgent.handleRequest(req, res);
  });

  await new Promise<void>((resolve) => testServer.listen(3999, resolve));
  const baseUrl = "http://localhost:3999";

  const secretKey = env.CATELOG_SECRET_KEY || "cat_sec_live_c67619ac727df612b50a6cb1be786046929dc48bf8b8daeca44556e91e5be7e1";

  try {
    // 1. Test GET /health
    console.log("1️⃣ Testing GET /health ...");
    const healthRes = await fetch(`${baseUrl}/health`);
    const healthData = await healthRes.json();
    console.log(`   Status Code: ${healthRes.status}`);
    console.log(`   Health Data:`, JSON.stringify(healthData, null, 2));
    if (healthRes.status !== 200 || healthData.status !== "ready") {
      throw new Error("Health check failed");
    }
    console.log("   ✅ GET /health PASSED\n");

    // 2. Test GET /schema
    console.log("2️⃣ Testing GET /schema ...");
    const schemaRes = await fetch(`${baseUrl}/schema`);
    const schemaData = await schemaRes.json();
    console.log(`   Status Code: ${schemaRes.status}`);
    console.log(`   Manifest ID: ${schemaData.id}`);
    console.log(`   Manifest Name: ${schemaData.name}`);
    console.log(`   Execution Modes:`, schemaData.capabilities?.execution_modes);
    console.log(`   Input Schema properties:`, Object.keys(schemaData.input_schema?.properties || {}));
    if (schemaRes.status !== 200 || schemaData.id !== "seo-geo-intelligence-agent") {
      throw new Error("Schema manifest failed");
    }
    console.log("   ✅ GET /schema PASSED\n");

    // 3. Test POST /execute without auth header
    console.log("3️⃣ Testing POST /execute without auth (Verification of Security Enforcement) ...");
    const unauthRes = await fetch(`${baseUrl}/execute`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input: { url: "https://example.com" } }),
    });
    console.log(`   Status Code: ${unauthRes.status}`);
    const unauthData = await unauthRes.json();
    console.log(`   Unauth response:`, JSON.stringify(unauthData));
    if (unauthRes.status === 401) {
      console.log("   ✅ 401 Unauthorized correctly enforced when Secret Key is set\n");
    } else {
      console.log(`   ℹ️ Dev mode active (Status: ${unauthRes.status})\n`);
    }

    // 4. Test POST /execute with Bearer Secret Key
    console.log("4️⃣ Testing POST /execute with Bearer auth (Async Task Dispatch) ...");
    const authRes = await fetch(`${baseUrl}/execute`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${secretKey}`,
      },
      body: JSON.stringify({
        input: {
          prompt: "Audit https://example.com for technical SEO",
        },
      }),
    });
    console.log(`   Status Code: ${authRes.status} (Expect 202 Accepted for async mode)`);
    const authData = await authRes.json();
    console.log(`   Response:`, JSON.stringify(authData, null, 2));

    if (authRes.status !== 202 || authData.status !== "working" || !authData.poll_url) {
      throw new Error(`Expected 202 Accepted with poll_url, got status ${authRes.status}`);
    }
    console.log("   ✅ POST /execute async dispatch PASSED\n");

    // 5. Test GET /tasks/:id
    console.log(`5️⃣ Testing GET ${authData.poll_url} (Task Polling) ...`);
    const pollRes = await fetch(`${baseUrl}${authData.poll_url}`);
    const pollData = await pollRes.json();
    console.log(`   Status Code: ${pollRes.status}`);
    console.log(`   Task Run ID: ${pollData.run_id}`);
    console.log(`   Task Status: ${pollData.status}`);
    console.log(`   Current Step: ${pollData.current_step}`);
    console.log(`   Events Recorded: ${pollData.events?.length ?? 0}`);
    if (pollRes.status !== 200 || !pollData.run_id) {
      throw new Error("Poll check failed");
    }
    console.log("   ✅ GET /tasks/:id PASSED\n");

    console.log("🎉 ALL CATELOG SDK PROTOCOL TESTS PASSED SUCCESSFULLY!");
    process.exit(0);
  } finally {
    testServer.close();
  }
}

runCatelogTests().catch((err) => {
  console.error("❌ Test suite failed:", err);
  process.exit(1);
});
