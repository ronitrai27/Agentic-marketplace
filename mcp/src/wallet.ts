import { config } from "./config.js";

export type WalletInfo = {
  credits: number;
  escrow: number;
  withdrawableCredits: number;
  totalUsd: string;
  escrowUsd: string;
  withdrawableUsd: string;
};

/** Reads one user's wallet from Convex via the server-to-server route. */
export async function fetchWallet(userId: string): Promise<WalletInfo> {
  if (!config.convexSiteUrl || !config.backendSecret) {
    throw new Error("CONVEX_SITE_URL and MCP_BACKEND_SECRET must be set");
  }
  const res = await fetch(`${config.convexSiteUrl}/mcp/wallet`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.backendSecret}`,
    },
    body: JSON.stringify({ userId }),
  });
  if (!res.ok) throw new Error(`Wallet backend returned ${res.status}`);
  return (await res.json()) as WalletInfo;
}
