import { NextResponse } from "next/server";
import { lookup } from "node:dns/promises";
import net from "node:net";
import { isAuthenticated } from "@/lib/auth-server";

const TIMEOUT_MS = 8000;
const MAX_BYTES = 512 * 1024;

function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127)
    );
  }
  const v6 = ip.toLowerCase();
  if (v6.startsWith("::ffff:")) return isPrivateIp(v6.slice(7));
  return (
    v6 === "::1" ||
    v6 === "::" ||
    v6.startsWith("fc") ||
    v6.startsWith("fd") ||
    v6.startsWith("fe80")
  );
}

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
  let base: URL;
  try {
    base = new URL(body?.url?.trim() ?? "");
  } catch {
    return NextResponse.json({ error: "Enter a valid URL." }, { status: 400 });
  }

  const dev = process.env.NODE_ENV !== "production";
  if (base.protocol !== "https:" && !(dev && base.protocol === "http:")) {
    return NextResponse.json(
      { error: "Agent URL must use https." },
      { status: 400 },
    );
  }

  // SSRF guard: never let the marketplace probe internal addresses.
  try {
    const addrs = await lookup(base.hostname, { all: true });
    if (!dev && addrs.some((a) => isPrivateIp(a.address))) {
      return NextResponse.json(
        { error: "URL must resolve to a public address." },
        { status: 400 },
      );
    }
  } catch {
    return NextResponse.json(
      { error: "Could not resolve this host." },
      { status: 422 },
    );
  }

  const root = base.href.replace(/\/+$/, "");
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
