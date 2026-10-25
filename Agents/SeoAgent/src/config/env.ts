import { config } from "dotenv";
import { z } from "zod";

config();

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  TEMPORAL_ADDRESS: z.string().default("localhost:7233"),
  TEMPORAL_NAMESPACE: z.string().default("default"),
  TEMPORAL_TASK_QUEUE: z.string().default("seo-agent-queue"),
  TEMPORAL_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  GROQ_API_KEY: z.string().optional(),
  OPENROUTER_JEV: z.string().optional(),
  OPENROUTER_API_KEY: z.string().optional(),
  JEV_MODEL: z.string().default("typesafe/jev-1.14"),
  BROWSERBASE_API_KEY: z.string().optional(),
  SERPAPI_KEY: z.string().optional(),
  GOOGLE_PAGESPEED_KEY: z.string().optional(),
  FIRECRAWL_API_KEY: z.string().optional(),
  CATELOG_SECRET_KEY: z.string().optional(),
  CATELOG_PUBLIC_KEY: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

const rawEnv = {
  ...process.env,
  CATELOG_SECRET_KEY: process.env.CATELOG_SECRET_KEY,
  CATELOG_PUBLIC_KEY: process.env.CATELOG_PUBLIC_KEY,
  TEMPORAL_API_KEY: process.env.TEMPORAL_API_KEY || process.env.TEMPORAL_KEY,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY || process.env.OPENAPI_KEY,
  OPENROUTER_JEV: process.env.OPENROUTER_JEV || process.env.OPENROUTER_API_KEY,
  SERPAPI_KEY: process.env.SERPAPI_KEY,
  GOOGLE_PAGESPEED_KEY: process.env.GOOGLE_PAGESPEED_KEY,
  FIRECRAWL_API_KEY: process.env.FIRECRAWL_API_KEY || process.env.FIRECRAWL_API_KEYS || "fc-f1db0e5309674aa2824f22a84514f8ad",
};

if (!process.env.OPENAI_API_KEY && rawEnv.OPENAI_API_KEY) {
  process.env.OPENAI_API_KEY = rawEnv.OPENAI_API_KEY;
}

const parsedEnv = envSchema.safeParse(rawEnv);

if (!parsedEnv.success) {
  console.error("❌ Invalid environment variables:", parsedEnv.error.format());
  throw new Error("Invalid environment configuration");
}

export const env = parsedEnv.data;
