import { lookup } from "node:dns/promises";
import net from "node:net";

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

export type AgentRoot =
  | { ok: true; root: string }
  | { ok: false; error: string; status: number };

/** Validates a creator-supplied agent URL and guards against SSRF. */
export async function resolveAgentRoot(raw?: string): Promise<AgentRoot> {
  let base: URL;
  try {
    base = new URL(raw?.trim() ?? "");
  } catch {
    return { ok: false, error: "Enter a valid URL.", status: 400 };
  }

  const dev = process.env.NODE_ENV !== "production";
  if (base.protocol !== "https:" && !(dev && base.protocol === "http:")) {
    return { ok: false, error: "Agent URL must use https.", status: 400 };
  }

  try {
    const addrs = await lookup(base.hostname, { all: true });
    if (!dev && addrs.some((a) => isPrivateIp(a.address))) {
      return {
        ok: false,
        error: "URL must resolve to a public address.",
        status: 400,
      };
    }
  } catch {
    return { ok: false, error: "Could not resolve this host.", status: 422 };
  }

  return { ok: true, root: base.href.replace(/\/+$/, "") };
}
