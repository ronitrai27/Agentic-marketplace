import { query } from "./_generated/server";

const PER_STATUS_LIMIT = 300;
const WINDOW_DAYS = 30;

/** Every finished run of the signed-in creator's agents (last 30 days), newest first. Never returns run input or output. */
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

    const rows: Array<{
      id: string;
      agentName: string;
      at: number;
      latencyMs: number | null;
      success: boolean;
      credits: number;
    }> = [];

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
          rows.push({
            id: r._id,
            agentName: agent.name,
            at,
            latencyMs: r.durationMs ?? (r.finishedAt && r.startedAt ? r.finishedAt - r.startedAt : null),
            success: status === "succeeded",
            credits: status === "succeeded" ? (r.chargedCredits ?? 0) : 0,
          });
        }
      }
    }
    return rows.sort((a, b) => b.at - a.at);
  },
});
