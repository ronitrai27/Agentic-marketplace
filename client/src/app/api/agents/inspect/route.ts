import { NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth-server";
import { resolveAgentRoot } from "@/lib/agent-url";

const TIMEOUT_MS = 8000;
const MAX_BYTES = 512 * 1024;

async function fetchJson(url: string) {
  const started = Date.now();
  const res = await fetch(url, {
    method: "GET",
    headers: { accept: "application/json" },
    redirect: "error",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const text = await res.text();
  if (text.length > MAX_BYTES) throw new Error("Response too large.");
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`${new URL(url).pathname} did not return valid JSON.`);
  }
  return { ok: res.ok, status: res.status, json, ms: Date.now() - started };
}

export async function POST(req: Request) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as { url?: string } | null;
  const target = await resolveAgentRoot(body?.url);
  if (!target.ok) {
    return NextResponse.json(
      { error: target.error },
      { status: target.status },
    );
  }
  const root = target.root;

  try {
    const health = await fetchJson(`${root}/health`);
    if (!health.ok) {
      return NextResponse.json(
        { error: `/health responded with HTTP ${health.status}.` },
        { status: 422 },
      );
    }
    const schema = await fetchJson(`${root}/schema`);
    if (!schema.ok) {
      return NextResponse.json(
        { error: `/schema responded with HTTP ${schema.status}.` },
        { status: 422 },
      );
    }
    return NextResponse.json({
      health: health.json,
      manifest: schema.json,
      latencyMs: health.ms,
    });
  } catch (e) {
    const msg =
      e instanceof Error && e.name === "TimeoutError"
        ? "Server took too long to respond."
        : e instanceof Error
          ? e.message
          : "Could not reach the server.";
    return NextResponse.json({ error: msg }, { status: 422 });
  }
}
