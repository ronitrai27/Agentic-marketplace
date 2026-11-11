/** Logos (served from /public) for the MCP clients that send run requests. */
export type McpClientInfo = { label: string; logo: string | null };

// Order matters: the first match wins ("Claude Code" before plain "Claude").
const KNOWN: Array<{ match: RegExp; label: string; logo: string }> = [
  { match: /claude[\s_-]?code/i, label: "Claude Code", logo: "/claudecode-color.svg" },
  { match: /claude/i, label: "Claude", logo: "/claude-color.svg" },
  { match: /hermes/i, label: "Hermes", logo: "/hermesagent.svg" },
  { match: /codex/i, label: "Codex", logo: "/codex-color.svg" },
  { match: /cursor/i, label: "Cursor", logo: "/cursor.svg" },
];

/** Older requests stored the raw OAuth client id (a long random string) instead of a name. */
const LOOKS_LIKE_ID = /^[A-Za-z0-9_-]{24,}$/;

/** Maps the registered client name (for example "Claude" or "Cursor") to a display name and logo. */
export function mcpClient(clientName: string | null | undefined): McpClientInfo {
  const name = (clientName ?? "").trim();
  if (!name || LOOKS_LIKE_ID.test(name)) return { label: "An MCP client", logo: null };
  const hit = KNOWN.find((k) => k.match.test(name));
  if (hit) return { label: hit.label, logo: hit.logo };
  return { label: name, logo: null };
}

/** Clients shown on the approvals and connect pages. */
export const SUPPORTED_CLIENTS = [
  { label: "Claude Code", logo: "/claudecode-color.svg" },
  { label: "Hermes", logo: "/hermesagent.svg" },
  { label: "Codex", logo: "/codex-color.svg" },
  { label: "Cursor", logo: "/cursor.svg" },
];

/** 100 credits = $1. */
export function creditsToUsd(credits: number): string {
  const usd = credits / 100;
  return `$${usd < 1 ? usd.toFixed(2) : usd.toFixed(usd % 1 === 0 ? 0 : 2)}`;
}
