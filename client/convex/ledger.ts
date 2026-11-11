import type { MutationCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";

type TxInput = Omit<Doc<"wallet_transactions">, "_id" | "_creationTime" | "createdAt"> & { createdAt?: number };

/** Appends one row to the user's wallet statement. Call it in the same mutation that changes the balance. */
export async function recordTx(ctx: MutationCtx, tx: TxInput) {
  return ctx.db.insert("wallet_transactions", { ...tx, createdAt: tx.createdAt ?? Date.now() });
}

/** Agent name and logo to snapshot on a row. */
export async function agentSnapshot(ctx: MutationCtx, agentId: Doc<"agents">["_id"]) {
  const agent = await ctx.db.get(agentId);
  return { agentId, agentName: agent?.name, agentLogoUrl: agent?.logoUrl };
}
