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
});

export type Env = z.infer<typeof envSchema>;

const rawEnv = {
  ...process.env,
  TEMPORAL_API_KEY: process.env.TEMPORAL_API_KEY || process.env.TEMPORAL_KEY,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY || process.env.OPENAPI_KEY,
};

const parsedEnv = envSchema.safeParse(rawEnv);

if (!parsedEnv.success) {
  console.error("❌ Invalid environment variables:", parsedEnv.error.format());
  throw new Error("Invalid environment configuration");
}

export const env = parsedEnv.data;
