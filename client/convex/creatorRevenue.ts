import { query } from "./_generated/server";
import { MICROS_PER_CREDIT } from "../src/lib/agent-display";
import { splitCharge } from "./revenue";

const PER_STATUS_LIMIT = 300;
const WINDOW_DAYS = 30;

/**
 * Every finished run of the signed-in creator's agents (last 30 days), newest first, with its earnings row.
 * Runs that finished before the ledger existed have no row: they are shown with the same split, as `legacy` (not in the wallet).
 * Never returns run input or output.
 */
export const runs = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const agents = await ctx.db
      .query("agents")
      .withIndex("by_owner", (q) => q.eq("ownerId", identity.subject))
      .collect();
    const cutoff = Date.now() - WINDOW_DAYS * 86_400_000;

    type Row = {
      id: string;
      agentName: string;
      at: number;
      latencyMs: number | null;
      success: boolean;
      grossMicros: number;
      commissionMicros: number;
      platformFeeMicros: number;
      netMicros: number;
      /** pending: inside the 48h hold. available: in the wallet. reversed: refunded. none: failed run. legacy: earned before the ledger, never added to the wallet. */
      status: "pending" | "available" | "paid" | "reversed" | "none" | "legacy";
      availableAt: number | null;
    };
    const rows: Row[] = [];

    for (const agent of agents) {
      for (const status of ["succeeded", "failed"] as const) {
        const found = await ctx.db
          .query("runs")
          .withIndex("by_agent_status", (q) => q.eq("agentId", agent._id).eq("status", status))
          .order("desc")
          .take(PER_STATUS_LIMIT);
        for (const r of found) {
          const at = r.finishedAt ?? r.createdAt;
          if (at < cutoff) continue;
          const latencyMs = r.durationMs ?? (r.finishedAt && r.startedAt ? r.finishedAt - r.startedAt : null);
          const base = { id: r._id as string, agentName: agent.name, at, latencyMs, success: status === "succeeded" };

          const ledger =
            status === "succeeded"
              ? await ctx.db.query("revenue_ledger").withIndex("by_run", (q) => q.eq("runId", r._id)).first()
              : null;
          if (ledger) {
            rows.push({
              ...base,
              grossMicros: ledger.grossMicros,
              commissionMicros: ledger.commissionMicros,
              platformFeeMicros: ledger.platformFeeMicros,
              netMicros: ledger.creatorNetMicros,
              status: ledger.status,
              availableAt: ledger.availableAt,
            });
          } else if (status === "succeeded" && (r.chargedCredits ?? 0) > 0) {
            const grossMicros = Math.round((r.chargedCredits ?? 0) * MICROS_PER_CREDIT);
            const split = splitCharge(grossMicros);
            rows.push({
              ...base,
              grossMicros,
              commissionMicros: split.commissionMicros,
              platformFeeMicros: split.platformFeeMicros,
              netMicros: split.creatorNetMicros,
              status: "legacy",
              availableAt: null,
            });
          } else {
            rows.push({
              ...base,
              grossMicros: 0,
              commissionMicros: 0,
              platformFeeMicros: 0,
              netMicros: 0,
              status: "none",
              availableAt: null,
            });
          }
        }
      }
    }
    return rows.sort((a, b) => b.at - a.at);
  },
});
