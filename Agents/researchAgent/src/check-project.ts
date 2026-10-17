import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const secretKey = (process.env.LANGFUSE_SECRET_KEY || "").replace(/"/g, "").trim();
const publicKey = (process.env.LANGFUSE_PUBLIC_KEY || "").replace(/"/g, "").trim();
const baseUrl = (process.env.LANGFUSE_BASE_URL || "").replace(/"/g, "").trim();

async function checkProject() {
  const authHeader = "Basic " + Buffer.from(`${publicKey}:${secretKey}`).toString("base64");
  
  // Fetch observations to see timestamps
  const res = await fetch(`${baseUrl}/api/public/v2/observations?limit=5`, {
    headers: { Authorization: authHeader },
  });
  const data = await res.json();
  console.log("Status:", res.status);
  console.log("Total observations count:", data.data?.length);
  if (data.data?.length > 0) {
    data.data.forEach((obs: any, idx: number) => {
      console.log(`Observation [${idx}]:`);
      console.log(`  - ID: ${obs.id}`);
      console.log(`  - Type: ${obs.type}`);
      console.log(`  - Name: ${obs.name}`);
      console.log(`  - StartTime: ${obs.startTime}`);
      console.log(`  - TraceId: ${obs.traceId}`);
      console.log(`  - ProjectId: ${obs.projectId}`);
    });
  }
}

checkProject();
