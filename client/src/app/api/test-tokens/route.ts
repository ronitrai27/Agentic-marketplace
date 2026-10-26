import { NextResponse } from "next/server";
import { fetchAuthAction, isAuthenticated } from "@/lib/auth-server";
import { api } from "@/../convex/_generated/api";
import {
  mintTestToken,
  TEST_TOKEN_TTLS,
  type TestTokenTtl,
} from "@/lib/test-token";

// Light per-creator throttle so a leaked session can't mint tokens in bulk.
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 10;
const hits = new Map<string, number[]>();

export async function POST(req: Request) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as {
    ttlSec?: number;
  } | null;
  const ttl = body?.ttlSec as TestTokenTtl;
  if (!TEST_TOKEN_TTLS.includes(ttl)) {
    return NextResponse.json(
      { error: `Expiry must be one of ${TEST_TOKEN_TTLS.join(", ")} seconds.` },
      { status: 400 },
    );
  }

  try {
    // Derived from the signed-in user server-side, never taken from the client.
    const publicKey = await fetchAuthAction(
      api.apiKeysActions.getOrCreatePublicKey,
      {},
    );

    const now = Date.now();
    const recent = (hits.get(publicKey) ?? []).filter(
      (t) => now - t < WINDOW_MS,
    );
    if (recent.length >= MAX_PER_WINDOW) {
      return NextResponse.json(
        { error: "Too many tokens. Try again in a minute." },
        { status: 429 },
      );
    }
    hits.set(publicKey, [...recent, now]);

    return NextResponse.json({
      ...mintTestToken(publicKey, ttl),
      publicKey,
    });
  } catch (e) {
    console.error("test token mint failed:", e);
    return NextResponse.json(
      { error: "Could not create a test token." },
      { status: 500 },
    );
  }
}
