import { OpenAIEmbeddings } from "@langchain/openai";
import { EMBED_DIMS } from "./db";

let client: OpenAIEmbeddings | undefined;
function embeddings() {
  client ??= new OpenAIEmbeddings({
    model: "text-embedding-3-small",
    dimensions: EMBED_DIMS,
    apiKey: process.env.OPENAI_API_KEY ?? process.env.OPENAPI_KEY,
  });
  return client;
}

/** pgvector's text form of a vector. */
export const toVector = (v: number[]) => `[${v.join(",")}]`;

const CACHE_MAX = 300;
const cache = new Map<string, number[]>();
const QUERY_TIMEOUT_MS = 1800;

/**
 * Embedding of a search query. Cached (people retype and backspace), and bounded in time: when OpenAI is slow or
 * down this returns null and search carries on with keywords and typo matching alone.
 */
export async function embedQuery(q: string, timeoutMs = QUERY_TIMEOUT_MS): Promise<number[] | null> {
  const key = q.trim().toLowerCase();
  const hit = cache.get(key);
  if (hit) {
    cache.delete(key); // refresh its place
    cache.set(key, hit);
    return hit;
  }
  try {
    const v = await Promise.race<number[] | null>([
      embeddings().embedQuery(key),
      new Promise<null>((r) => setTimeout(() => r(null), timeoutMs)),
    ]);
    if (!v) {
      console.error(`[search] query embedding timed out after ${timeoutMs}ms`);
      return null;
    }
    cache.set(key, v);
    if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value as string);
    return v;
  } catch (e) {
    console.error("[search] query embedding failed:", e instanceof Error ? e.message : e);
    return null;
  }
}

/** Embeddings for agent texts, in the same order. Throws on failure so the caller can retry later. */
export async function embedDocuments(texts: string[]): Promise<number[][]> {
  return embeddings().embedDocuments(texts);
}
