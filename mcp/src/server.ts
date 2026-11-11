import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { fetchWallet } from "./wallet.js";
import { registerAgentTools } from "./tools/agents.js";
import { registerRunTools } from "./tools/runs.js";

/** Must return a fresh instance on every call (the handler builds one per request). */
export function createServer(): McpServer {
  const server = new McpServer({ name: "catelog", version: "0.1.0" });

  server.registerTool(
    "get_wallet_info",
    {
      description:
        "Get the signed-in Catelog user's wallet: credit balance (100 credits = $1), " +
        "credits held in escrow, and how much is withdrawable. Use it to check what the user can afford.",
      inputSchema: z.object({}),
    },
    async (_args, ctx) => {
      const userId = ctx.http?.authInfo?.extra?.userId;
      if (typeof userId !== "string") {
        return { isError: true, content: [{ type: "text", text: "Not authenticated." }] };
      }
      try {
        const w = await fetchWallet(userId);
        const text =
          `Balance: ${w.credits} credits ($${w.totalUsd})\n` +
          `In escrow: ${w.escrow} credits ($${w.escrowUsd})\n` +
          `Withdrawable: ${w.withdrawableCredits} credits ($${w.withdrawableUsd}) — a 500-credit ($5) reserve must stay in the wallet.`;
        return { content: [{ type: "text", text }], structuredContent: w };
      } catch (e) {
        console.error("get_wallet_info failed:", e);
        return { isError: true, content: [{ type: "text", text: "Could not load wallet right now." }] };
      }
    },
  );

  registerAgentTools(server);
  registerRunTools(server);

  return server;
}
