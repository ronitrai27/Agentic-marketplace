"use node";

import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { ConvexError, v } from "convex/values";
import { assertPublicUrl } from "../src/lib/ssrf";

/** How long the confirm dialog waits for an agent to answer before giving up. */
const DEADLINE_MS = 180_000;
const PROBE_TIMEOUT_MS = 5_000;
const RETRY_EVERY_MS = 3_000;

type Result = { ok: true; latencyMs: number } | { ok: false; code: string; message: string };

async function probe(baseUrl: string): Promise<number | null> {
  const started = Date.now();
  try {
    const res = await fetch(`${baseUrl}/health`, {
      redirect: "manual",
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    const body = (await res.json().catch(() => null)) as { status?: string; environment_ready?: boolean } | null;
    if (body?.status !== "ready" || body.environment_ready === false) return null;
    return Date.now() - started;
  } catch {
    return null;
  }
}

/**
 * Step 2 of the confirm dialog. Pings the agent's /health from the server (the browser never sees the URL),
 * retrying for up to 180s (sleeping servers get time to wake). Failing that, it counts a strike against the agent; three strikes in a row pause it.
 */
export const checkAgent = action({
  args: { slug: v.string() },
  handler: async (ctx, { slug }): Promise<Result> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Please sign in." });

    const target = await ctx.runQuery(internal.runs.agentTarget, { slug });
    if (!target) return { ok: false, code: "AGENT_NOT_FOUND", message: "Agent not found." };
    if (target.status === "paused") return { ok: false, code: "AGENT_PAUSED", message: "This agent is paused." };
    if (!target.hasKey) {
      return { ok: false, code: "NO_SIGNING_KEY", message: "This agent is not set up for marketplace runs yet." };
    }

    try {
      await assertPublicUrl(target.baseUrl);
    } catch {
      return { ok: false, code: "UNREACHABLE", message: "Agent server is not reachable." };
    }

    const deadline = Date.now() + DEADLINE_MS;
    while (Date.now() < deadline) {
      const latencyMs = await probe(target.baseUrl);
      if (latencyMs !== null) {
        await ctx.runMutation(internal.runs.recordHealth, { agentId: target.agentId, ok: true });
        return { ok: true, latencyMs };
      }
      await new Promise((r) => setTimeout(r, RETRY_EVERY_MS));
    }

    const { paused } = await ctx.runMutation(internal.runs.recordHealth, { agentId: target.agentId, ok: false });
    return {
      ok: false,
      code: paused ? "AGENT_PAUSED" : "UNREACHABLE",
      message: "Agent server is not reachable.",
    };
  },
});
