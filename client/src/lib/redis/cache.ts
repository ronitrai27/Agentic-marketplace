import { getRedis } from "./client";

/**
 * Read-through cache: returns the cached value, otherwise runs `load`, stores the result
 * for `ttlSeconds` and returns it. Redis errors never break the request; we just load fresh.
 */
export async function cached<T>(key: string, ttlSeconds: number, load: () => Promise<T>): Promise<T> {
  const redis = getRedis();
  if (redis) {
    try {
      const hit = await redis.get<T>(key);
      if (hit !== null && hit !== undefined) return hit;
    } catch {
      // fall through to the database
    }
  }

  const fresh = await load();

  if (redis) {
    try {
      await redis.set(key, fresh, { ex: ttlSeconds });
    } catch {
      // cache write failed; the response is still correct
    }
  }
  return fresh;
}
