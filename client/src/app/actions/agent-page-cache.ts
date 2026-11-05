"use server";

import { getRedis } from "@/lib/redis/client";
import { agentPageKey } from "@/lib/redis/agent-page-cache";

/**
 * Drops the cached agent page so the next visit rebuilds it from Convex with the new rating and reviews.
 * Called by the browser right after a review is saved or deleted. It only deletes a cache entry.
 */
export async function refreshAgentPage(slug: string): Promise<void> {
  if (typeof slug !== "string" || !/^[a-z0-9-]{1,100}$/i.test(slug)) return;
  try {
    await getRedis()?.del(agentPageKey(slug));
  } catch {
    // the cache expires on its own within 20 minutes
  }
}
