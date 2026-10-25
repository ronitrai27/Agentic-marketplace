import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const bool = (d: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? d : v === 'true' || v === '1'));
const num = (d: number) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? d : Number(v)));

const EnvSchema = z.object({
  PORT: num(3008),
  LOG_LEVEL: z.string().default('info'),
  DATABASE_URL: z.string().default('postgresql://patent_app:patent_app_pw@localhost:5437/patent_agent'),
  DATABASE_OPS_URL: z.string().optional(), // defaults to DATABASE_URL if unset
  TENANT_DEMO_ID: z.string().default('11111111-1111-1111-1111-111111111111'),
  API_KEY: z.string().optional(),
  MARKETPLACE_SECRET: z.string().optional(),

  FREE_MODE: bool(true),
  LLM_CHAIN: z.string().default('openai,groq,gemini,ollama'),
  GROQ_API_KEY: z.string().optional(),
  GROQ_MODEL: z.string().default('openai/gpt-oss-120b'),
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().default('gemini-2.5-flash'),
  OLLAMA_BASE_URL: z.string().default('http://localhost:11434'),
  OLLAMA_MODEL: z.string().default('qwen2.5:7b'),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default('gpt-4.1-mini'),
  LLM_TEMPERATURE: z.coerce.number().default(0.1),
  // India jurisdiction
  JURISDICTION: z.string().default('IN'),
  IP_INDIA_SEARCH_URL: z.string().default('https://iprsearch.ipindia.gov.in'),

  EMBED_PROVIDER: z.string().default('hash'),
  EMBED_DIM: num(384),

  // India sources only
  ARXIV_ENABLED: bool(true),

  PRICING_MODE: z.enum(['runtime', 'tier']).default('runtime'),
  RUNTIME_RATE: z.coerce.number().default(0.04),
  MIN_RUN_FEE: z.coerce.number().default(0.1),
  MAX_RUN_FEE: z.coerce.number().default(1.5),
  TENANT_DAILY_CAP: z.coerce.number().default(20),
  PAYPAL_MODE: z.enum(['mock', 'sandbox', 'live']).default('mock'),
  PAYPAL_CLIENT_ID: z.string().optional(),
  PAYPAL_CLIENT_SECRET: z.string().optional(),

  MAX_CANDIDATES: num(50),
  MAX_CROSS_REFERENCED: num(10),
  MAX_CLAIMS: num(20),
  MAX_DRAFT_CHARS: num(20000),
  MAX_FETCH_CHARS: num(6000),
  MAX_FILE_BYTES: num(10 * 1024 * 1024),

  RUNNER: z.enum(['inline', 'external']).default('inline'),
  UI_MODE: z.enum(['persona', 'form']).default('persona'),
  SHOW_TEAM_RAIL: bool(true),
});

export type Config = z.infer<typeof EnvSchema>;

function dotenvLite(path: string): void {
  try {
    if (!existsSync(path)) return;
    for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      const key = m?.[1];
      if (key && process.env[key] === undefined) {
        process.env[key] = (m?.[2] ?? '').replace(/^["']|["']$/g, '');
      }
    }
  } catch {
    /* env file optional */
  }
}

let cached: Config | null = null;

export function config(): Config {
  if (cached) return cached;
  // config.ts lives in src/ → one level up is the project root. fileURLToPath (rather than
  // .pathname) also decodes %20 — this project's folder name contains a space.
  dotenvLite(fileURLToPath(new URL('../.env', import.meta.url)));
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment:\n${issues}\n\nCopy .env.example → .env and fill DATABASE_URL.`);
  }
  cached = parsed.data;
  return cached;
}
