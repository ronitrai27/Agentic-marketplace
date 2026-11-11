/** Logos (served from /public) for the MCP clients that send run requests. */
export type McpClientInfo = { label: string; logo: string | null };

const KNOWN: Array<{ match: RegExp; label: string; logo: string }> = [
  { match: /claude/i, label: "Claude Code", logo: "/claudecode-color.svg" },
  { match: /hermes/i, label: "Hermes", logo: "/hermesagent.svg" },
  { match: /codex/i, label: "Codex", logo: "/codex-color.svg" },
  { match: /cursor/i, label: "Cursor", logo: "/cursor.svg" },
];

/** Maps the MCP clientInfo name (for example "claude-code" or "Cursor") to a display name and logo. */
export function mcpClient(clientName: string | null | undefined): McpClientInfo {
  const name = (clientName ?? "").trim();
  const hit = KNOWN.find((k) => k.match.test(name));
  if (hit) return { label: hit.label, logo: hit.logo };
  return { label: name || "An MCP client", logo: null };
}

export const SUPPORTED_CLIENTS = KNOWN.map(({ label, logo }) => ({ label, logo }));

/** 100 credits = $1. */
export function creditsToUsd(credits: number): string {
  const usd = credits / 100;
  return `$${usd < 1 ? usd.toFixed(2) : usd.toFixed(usd % 1 === 0 ? 0 : 2)}`;
}
