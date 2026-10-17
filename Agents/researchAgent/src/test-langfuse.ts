import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { Langfuse } from "langfuse";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const secretKey = (process.env.LANGFUSE_SECRET_KEY || "").replace(/"/g, "").trim();
const publicKey = (process.env.LANGFUSE_PUBLIC_KEY || "").replace(/"/g, "").trim();
const baseUrl = (process.env.LANGFUSE_BASE_URL || "").replace(/"/g, "").trim();

async function testEndpoint(url: string) {
  console.log(`\n========================================`);
  console.log(`Testing Base URL: ${url}`);
  console.log(`========================================`);

  // Direct fetch to Langfuse health check / auth check
  const authHeader = "Basic " + Buffer.from(`${publicKey}:${secretKey}`).toString("base64");
  try {
    const res = await fetch(`${url}/api/public/health`, {
      headers: { Authorization: authHeader },
    });
    console.log(`Health check: status ${res.status}`);
  } catch (err: any) {
    console.log(`Health check failed: ${err.message}`);
  }

  try {
    const res = await fetch(`${url}/api/public/traces`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authHeader,
      },
      body: JSON.stringify({
        batch: [
          {
            id: "test-" + Date.now(),
            type: "trace-create",
            timestamp: new Date().toISOString(),
            body: {
              name: "manual-fetch-test-trace",
              input: "hello langfuse",
              output: "testing",
            },
          },
        ],
      }),
    });
    const body = await res.text();
    console.log(`POST /api/public/traces response: status ${res.status}`);
    console.log(`Response body:`, body);
  } catch (err: any) {
    console.log(`POST /api/public/traces failed: ${err.message}`);
  }
}

async function run() {
  await testEndpoint(baseUrl);
  if (baseUrl !== "https://cloud.langfuse.com") {
    await testEndpoint("https://cloud.langfuse.com");
  }
  if (baseUrl !== "https://us.cloud.langfuse.com") {
    await testEndpoint("https://us.cloud.langfuse.com");
  }
}

run();
