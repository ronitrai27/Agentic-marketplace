/**
 * Free-first LLM chain: groq → gemini → ollama → openai (env-ordered).
 * A free-tier 429 degrades to the next provider mid-run instead of failing.
 * No keys at all → chatJSON throws LlmUnavailableError and the pipeline
 * uses its deterministic offline fallbacks (see workflow/).
 */
import { z, type ZodType } from 'zod';
import { config } from '../config.js';
import { delay } from '../lib/util.js';

export class LlmUnavailableError extends Error {
  constructor(reason = 'no LLM provider configured') {
    super(reason);
  }
}

export interface LlmUsage {
  tokensIn: number;
  tokensOut: number;
}
export interface ChatResult<T> {
  data: T;
  usage: LlmUsage;
  provider: string;
  degraded?: boolean;
}

interface Provider {
  name: string;
  call: (system: string, user: string, temperature: number) => Promise<{ text: string; usage: LlmUsage }>;
}

function providers(): Provider[] {
  const c = config();
  const chain = c.LLM_CHAIN.split(',').map((s) => s.trim()).filter(Boolean);
  const out: Provider[] = [];

  const openaiCompatible = (name: string, baseUrl: string, model: string, key: string | undefined, jsonMode = true): Provider => ({
    name,
    call: async (system, user, temperature) => {
      if (!key && name !== 'ollama') throw new LlmUnavailableError(`${name}: missing API key`);
      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(key ? { authorization: `Bearer ${key}` } : {}),
        },
        body: JSON.stringify({
          model,
          temperature,
          ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
        }),
        signal: AbortSignal.timeout(45_000),
      });
      if (!res.ok) throw new Error(`${name} HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const j = (await res.json()) as {
        choices: { message: { content: string } }[];
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      return {
        text: j.choices[0]?.message?.content ?? '',
        usage: { tokensIn: j.usage?.prompt_tokens ?? 0, tokensOut: j.usage?.completion_tokens ?? 0 },
      };
    },
  });

  const gemini: Provider = {
    name: 'gemini',
    call: async (system, user, temperature) => {
      const key = c.GEMINI_API_KEY;
      if (!key) throw new LlmUnavailableError('gemini: missing API key');
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${c.GEMINI_MODEL}:generateContent?key=${key}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: 'user', parts: [{ text: user }] }],
          generationConfig: { temperature, responseMimeType: 'application/json' },
        }),
        signal: AbortSignal.timeout(45_000),
      });
      if (!res.ok) throw new Error(`gemini HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const j = (await res.json()) as {
        candidates?: { content?: { parts?: { text?: string }[] } }[];
        usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
      };
      const text = j.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
      return {
        text,
        usage: {
          tokensIn: j.usageMetadata?.promptTokenCount ?? 0,
          tokensOut: j.usageMetadata?.candidatesTokenCount ?? 0,
        },
      };
    },
  };

  for (const name of chain) {
    if (name === 'openai')
      out.push(openaiCompatible('openai', 'https://api.openai.com/v1', c.OPENAI_MODEL, c.OPENAI_API_KEY));
    else if (name === 'groq')
      out.push(openaiCompatible('groq', 'https://api.groq.com/openai/v1', c.GROQ_MODEL, c.GROQ_API_KEY));
    else if (name === 'gemini') out.push(gemini);
    else if (name === 'ollama')
      out.push(openaiCompatible('ollama', `${c.OLLAMA_BASE_URL}/v1`, c.OLLAMA_MODEL, 'ollama', true));
  }
  return out;
}

export function llmAvailable(): boolean {
  try {
    return providers().length > 0;
  } catch {
    return false;
  }
}

/** Strip fences / preamble and return the JSON object substring. */
export function recoverJson(text: string): string {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const body = fenced?.[1] ?? text;
  const first = body.indexOf('{');
  const last = body.lastIndexOf('}');
  if (first === -1 || last === -1 || last <= first) throw new Error('no JSON object in LLM reply');
  return body.slice(first, last + 1);
}

export interface ChatJSONOptions<T> {
  system: string;
  user: string;
  schema: ZodType<T, z.ZodTypeDef, any>;
  temperature?: number;
}

/** One JSON-constrained call with schema validation + one repair retry, provider failover. */
export async function chatJSON<T>(opts: ChatJSONOptions<T>): Promise<ChatResult<T>> {
  const temp = opts.temperature ?? config().LLM_TEMPERATURE;
  const list = providers();
  if (!list.length) throw new LlmUnavailableError();

  let lastErr: Error | null = null;
  for (const p of list) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const system =
          attempt === 0
            ? `${opts.system}\nReply with a single valid JSON object only. No prose, no code fences.`
            : `Your previous reply failed JSON validation (${lastErr?.message ?? 'unknown'}). Reply again with ONLY a valid JSON object matching the schema. No prose.`;
        const user = attempt === 0 ? opts.user : `${opts.user}\n\nPrevious reply was invalid.`;
        const res = await p.call(system, user, temp);
        const parsed = opts.schema.safeParse(JSON.parse(recoverJson(res.text)));
        if (parsed.success) return { data: parsed.data, usage: res.usage, provider: p.name };
        lastErr = new Error(`schema: ${parsed.error.issues.slice(0, 3).map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
      } catch (e) {
        lastErr = e instanceof Error ? e : new Error(String(e));
        if (/HTTP 429|rate limit/i.test(lastErr.message)) {
          await delay(700);
          continue; // retry same provider once, then fail over
        }
        break; // hard failure → next provider
      }
    }
  }
  throw new LlmUnavailableError(`all providers failed: ${lastErr?.message ?? 'unknown'}`);
}

export const usageAcc = () => {
  let tokensIn = 0;
  let tokensOut = 0;
  return {
    add: (u: LlmUsage) => {
      tokensIn += u.tokensIn;
      tokensOut += u.tokensOut;
    },
    total: () => ({ tokensIn, tokensOut }),
  };
};

// Shared schema helpers for the pipeline steps
export const LlmClaimSchema = z.object({
  claims: z
    .array(
      z.object({
        claimNo: z.number().int().positive(),
        type: z.enum(['independent', 'dependent']),
        provisional: z.boolean().default(false),
        text: z.string().min(10),
        elements: z.array(z.object({ text: z.string().min(2) })).min(1),
      }),
    )
    .min(1),
  approach: z.string().default(''),
});
export type LlmClaims = z.infer<typeof LlmClaimSchema>;

export const LlmChartCellSchema = z.object({
  match: z.enum(['disclosed', 'partial', 'not_found']),
  quote: z.string().default(''),
  locator: z.string().default(''),
  commentary: z.string().default(''),
});
export type LlmChartCell = z.infer<typeof LlmChartCellSchema>;

export const LlmVerdictSchema = z.object({
  redFlags: z.array(z.string()).default([]),
  rewriteSuggestions: z.array(z.string()).default([]),
  closestReferenceNote: z.string().default(''),
});
export type LlmVerdict = z.infer<typeof LlmVerdictSchema>;

export const LlmQueriesSchema = z.object({
  queries: z.array(z.string()).min(1).max(4),
  cpcGuess: z.string().default(''),
});
