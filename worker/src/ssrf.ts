import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

function privateV4(ip: string): boolean {
  const [a, b] = ip.split(".").map(Number);
  return (
    a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19))
  );
}

function privateIp(ip: string): boolean {
  if (isIP(ip) === 4) return privateV4(ip);
  const v6 = ip.toLowerCase();
  const mapped = v6.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return privateV4(mapped[1]);
  return (
    v6 === "::" || v6 === "::1" ||
    v6.startsWith("fc") || v6.startsWith("fd") ||
    v6.startsWith("fe8") || v6.startsWith("fe9") || v6.startsWith("fea") || v6.startsWith("feb")
  );
}

/**
 * Throws unless the URL is http(s) and every address its host resolves to is public.
 * `ALLOW_PRIVATE_AGENT_HOSTS=true` turns the check off for local development only.
 */
export async function assertPublicUrl(raw: string): Promise<void> {
  if (process.env.ALLOW_PRIVATE_AGENT_HOSTS === "true") return;
  const url = new URL(raw);
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("Unsupported protocol");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
  if (addresses.length === 0 || addresses.some((a) => privateIp(a.address))) {
    throw new Error("Agent address is not public");
  }
}
