/**
 * Embeddings — free-first.
 *   hash (default): feature-hashing of tokens + bigrams, 384-d, deterministic, offline $0.
 *   openai:         text-embedding-3-small when a key exists (costs money).
 *   transformers:   local bge-small via @xenova/transformers if installed.
 * Invention text never leaves the machine on `hash`/`transformers`.
 */
import { createHash } from 'node:crypto';
import { config } from '../config.js';
import { tokenize } from '../lib/util.js';

const STOP = new Set(tokenize('the a an of to in for and or with on at by from is are was were be this that'));

function hashToken(tok: string, dim: number): { idx: number; sign: number } {
  const h = createHash('md5').update(tok).digest();
  const idx = (h.readUInt32BE(0) >>> 0) % dim;
  const sign = (h[4]! & 1) === 0 ? 1 : -1;
  return { idx, sign };
}

/** Feature-hashing embedding: unigrams + bigrams, tf weights, L2-normalized. */
export function hashEmbed(text: string, dim = config().EMBED_DIM): number[] {
  const tokens = tokenize(text).filter((t) => !STOP.has(t));
  const vec = new Array<number>(dim).fill(0);
  const grams = [...tokens, ...tokens.map((t, i) => (i ? `${t}_${tokens[i - 1]}` : ''))];
  for (const g of grams) {
    if (!g) continue;
    const { idx, sign } = hashToken(g, dim);
    vec[idx] = (vec[idx] ?? 0) + sign;
  }
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
  if (norm === 0) return vec;
  return vec.map((v) => v / norm);
}

export function cosine(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  for (let i = 0; i < n; i++) dot += (a[i] ?? 0) * (b[i] ?? 0);
  return dot; // inputs are L2-normalized
}

export async function embedTexts(texts: string[]): Promise<number[][]> {
  const provider = config().EMBED_PROVIDER;
  if (provider === 'openai' && config().OPENAI_API_KEY) {
    try {
      return await openaiEmbed(texts);
    } catch {
      return texts.map((t) => hashEmbed(t));
    }
  }
  if (provider === 'transformers') {
    try {
      const mod = (await import('@xenova/transformers' as string)) as {
        pipeline: (t: string, m: string) => Promise<(i: string) => Promise<number[][]>>;
      };
      const extractor = await mod.pipeline('feature-extraction', 'Xenova/bge-small-en-v1.5');
      const out: number[][] = [];
      for (const t of texts) {
        const r = await extractor(t);
        // mean-pool token embeddings
        const dim = r[0]?.length ?? config().EMBED_DIM;
        const acc = new Array<number>(dim).fill(0);
        for (const row of r) for (let i = 0; i < dim; i++) acc[i] = (acc[i] ?? 0) + (row[i] ?? 0);
        const norm = Math.sqrt(acc.reduce((s, v) => s + v * v, 0)) || 1;
        out.push(acc.map((v) => v / norm));
      }
      return out;
    } catch {
      return texts.map((t) => hashEmbed(t));
    }
  }
  return texts.map((t) => hashEmbed(t));
}

async function openaiEmbed(texts: string[]): Promise<number[][]> {
  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${config().OPENAI_API_KEY}`,
    },
    body: JSON.stringify({ model: 'text-embedding-3-small', input: texts }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`embeddings HTTP ${res.status}`);
  const j = (await res.json()) as { data: { embedding: number[] }[] };
  return j.data.map((d) => d.embedding);
}
