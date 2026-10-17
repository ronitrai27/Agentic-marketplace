import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const secretKey = (process.env.LANGFUSE_SECRET_KEY || "").replace(/"/g, "").trim();
const publicKey = (process.env.LANGFUSE_PUBLIC_KEY || "").replace(/"/g, "").trim();

async function checkTraces() {
  const authHeader = "Basic " + Buffer.from(`${publicKey}:${secretKey}`).toString("base64");
  const res = await fetch("https://hipaa.cloud.langfuse.com/api/public/v2/observations", {
    headers: { Authorization: authHeader },
  });
  const text = await res.text();
  console.log("Status:", res.status);
  console.log("Raw Response:", text);
}

checkTraces();
