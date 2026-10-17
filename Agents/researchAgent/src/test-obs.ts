import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { Langfuse } from "langfuse";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const secretKey = (process.env.LANGFUSE_SECRET_KEY || "").replace(/"/g, "").trim();
const publicKey = (process.env.LANGFUSE_PUBLIC_KEY || "").replace(/"/g, "").trim();
const baseUrl = (process.env.LANGFUSE_BASE_URL || "").replace(/"/g, "").trim();

async function run() {
  const langfuse = new Langfuse({
    secretKey,
    publicKey,
    baseUrl,
  });

  const trace = langfuse.trace({
    name: "test-deep-research-trace",
    input: { prompt: "Analyze humanoid robotics trends" },
    metadata: { env: "development" },
  });

  const span = trace.span({
    name: "orchestrator-planning",
    input: { topic: "Humanoid robotics" },
  });

  const gen = trace.generation({
    name: "gpt-4.1-mini-planner",
    model: "gpt-4.1-mini",
    input: [{ role: "user", content: "Plan research sections" }],
    output: { sections: ["Hardware", "Software", "Market"] },
    usage: {
      input: 300,
      output: 150,
      total: 450,
    },
  });

  span.end({
    output: { status: "Sections planned" },
  });

  trace.update({
    output: { finalReport: "Report compiled successfully" },
  });

  console.log("Flushing Langfuse events...");
  await langfuse.flushAsync();
  console.log("Flush complete! Trace ID:", trace.id);

  // Now query observations API
  const authHeader = "Basic " + Buffer.from(`${publicKey}:${secretKey}`).toString("base64");
  const res = await fetch(`${baseUrl}/api/public/v2/observations`, {
    headers: { Authorization: authHeader },
  });
  const data = await res.json();
  console.log("Observations in Langfuse now:", data.data?.length);
  if (data.data?.length > 0) {
    console.log("Latest Observation:", data.data[0]);
  }
}

run();
