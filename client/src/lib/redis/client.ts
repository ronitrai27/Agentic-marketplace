import { Redis } from "@upstash/redis";

/**
 * Upstash Redis over REST. Server-side only: the token has write access.
 * Returns null when env vars are missing so callers fall back to the database.
 */
let client: Redis | null | undefined;

export function getRedis(): Redis | null {
  if (client !== undefined) return client;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  client = url && token ? new Redis({ url, token }) : null;
  return client;
}
