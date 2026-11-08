import { Ratelimit } from "@upstash/ratelimit";
import { getRedis } from "@/lib/redis/client";
import { getToken } from "@/lib/auth-server";

/** Questions one user may send the chef per window. Approval answers (resume) are not counted. */
export const CHEF_LIMIT = 5;
export const CHEF_WINDOW = "60 s";

/** The user id from the session token. It only namespaces the thread and the limiter; Convex still verifies the token on every write. */
function subjectOf(jwt: string): string | null {
  try {
    const payload = JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString("utf8"));
    return typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}

export type ChefGate = { ok: true; token: string; userId: string } | { ok: false; response: Response };

/**
 * Gate in front of the chef route: only a signed-in user gets through (guests and missing sessions get 401 with
 * code LOGIN_REQUIRED, which the browser turns into a "log in first" toast).
 */
export async function chefAuth(): Promise<ChefGate> {
  const token = await getToken();
  const userId = token ? subjectOf(token) : null;
  if (!token || !userId) {
    return { ok: false, response: Response.json({ error: "You need to log in first.", code: "LOGIN_REQUIRED" }, { status: 401 }) };
  }
  return { ok: true, token, userId };
}

let limiter: Ratelimit | null | undefined;
function getLimiter(): Ratelimit | null {
  if (limiter !== undefined) return limiter;
  const redis = getRedis();
  limiter = redis
    ? new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(CHEF_LIMIT, CHEF_WINDOW), prefix: "rl:chef", analytics: false })
    : null;
  return limiter;
}

/**
 * 5 questions per minute per user (sliding window, Upstash). Returns a 429 response when over the limit, else null.
 * If Redis is down or not configured the request is let through (and logged): the chef stays up, only the cap is lost.
 */
export async function chefRateLimit(userId: string): Promise<Response | null> {
  const rl = getLimiter();
  if (!rl) {
    console.warn("[chef] rate limit disabled: Upstash env vars are not set");
    return null;
  }
  try {
    const r = await rl.limit(userId);
    if (r.success) return null;
    const retryAfter = Math.max(1, Math.ceil((r.reset - Date.now()) / 1000));
    return Response.json(
      { error: `You're sending messages too fast. Try again in ${retryAfter}s.`, code: "RATE_LIMITED", retryAfter },
      { status: 429, headers: { "Retry-After": String(retryAfter) } },
    );
  } catch (e) {
    console.error("[chef] rate limiter failed, letting the request through:", e instanceof Error ? e.message : e);
    return null;
  }
}
