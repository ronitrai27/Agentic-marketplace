import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load .env from root of Agents directory
dotenv.config({ path: path.resolve(__dirname, "../../../.env") });
dotenv.config({ path: path.resolve(process.cwd(), ".env") });
dotenv.config({ path: path.resolve(process.cwd(), "../.env") });

export const ENV = {
  OPENAI_API_KEY: process.env.OPENAPI_KEY || process.env.OPENAI_API_KEY || "",
  OPENAI_MODEL: "gpt-4.1-mini",
  
  GROQ_API_KEY: process.env.GROQ_API_KEY || "",
  GROQ_MODEL: process.env.GROQ_MODEL || "openai/gpt-oss-120b",
  
  OPENROUTER_JEV: process.env.OPENROUTER_JEV || "",
  JEV_MODEL: process.env.JEV_MODEL || "typesafe/jev-1.14",
  
  FIRECRAWL_API_KEY: process.env.FIRECRAWL_API_KEY || "",
  SERPAPI_KEY: process.env.SERPAI_KEY || process.env.SERPAPI_API_KEY || "",
  
  // Langfuse Observability
  LANGFUSE_SECRET_KEY: process.env.LANGFUSE_SECRET_KEY?.replace(/"/g, "") || "",
  LANGFUSE_PUBLIC_KEY: process.env.LANGFUSE_PUBLIC_KEY?.replace(/"/g, "") || "",
  LANGFUSE_BASE_URL: process.env.LANGFUSE_BASE_URL?.replace(/"/g, "") || "https://hipaa.cloud.langfuse.com",

  // Catelog Marketplace SDK
  CATELOG_SECRET_KEY: process.env.CATELOG_SECRET_KEY || process.env.MARKETPLACE_SECRET || "cat_sec_live_fe471b4c5047d5b81e369db1f67d78dd8fc6dd1d371634d7a3ad7566041422f0",
  CATELOG_PUBLIC_KEY: process.env.CATELOG_PUBLIC_KEY || "cat_pub_live_21030fbabcbe3b8a1b8a09dd",
  
  // Temporal Configuration
  TEMPORAL_ADDRESS: process.env.TEMPORAL_ADDRESS || "localhost:7233",
  TEMPORAL_NAMESPACE: process.env.TEMPORAL_NAMESPACE || "default",
  TEMPORAL_API_KEY: process.env.TEMPORAL_API_KEY || "",
  TEMPORAL_TASK_QUEUE: process.env.TEMPORAL_TASK_QUEUE || "deep-research",

  // Guardrail thresholds
  JEV_OFFENSIVE_THRESHOLD: 0.5,
  JEV_RESEARCH_THRESHOLD: 0.5,
  
  // Performance & Cost Guardrails
  MAX_SECTIONS: 3,
  MAX_QUERIES_PER_SECTION: 2,
  MAX_SCRAPE_PER_QUERY: 2,
  MAX_SCRAPE_CHARS: 6000,
  MAX_CRITIC_ROUNDS: 1,
};
