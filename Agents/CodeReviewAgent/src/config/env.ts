import "dotenv/config";

function required(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}. Copy .env.example to .env and fill it in.`);
  }
  return value;
}

export const ENV = {
  PORT: Number(process.env.PORT ?? 3006),
  OPENAI_API_KEY: required("OPENAI_API_KEY"),
  OPENAI_MODEL: process.env.OPENAI_MODEL ?? "gpt-4.1-mini",
  DATABASE_URL: process.env.DATABASE_URL ?? "postgres://review:review_local_password@localhost:5435/code_review_agent",
  MAX_FILES: Number(process.env.MAX_FILES ?? 10),
  MAX_FILE_BYTES: Number(process.env.MAX_FILE_BYTES ?? 200 * 1024),
  MAX_CODE_CHARS: 60_000,
  REPO_CLONE_TIMEOUT_MS: Number(process.env.REPO_CLONE_TIMEOUT_MS ?? 300_000),
} as const;
