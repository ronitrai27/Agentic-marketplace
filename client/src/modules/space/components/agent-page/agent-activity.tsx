"use client";

import { useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { AgentActivityCharts, type DailyPoint } from "./agent-activity-charts";

type Stats = { totalRuns: number; successRuns: number; failedRuns: number; totalLatencyMs: number };

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="p-4">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tracking-tight tabular-nums text-foreground">{value}</p>
      {note && <p className="mt-0.5 text-[11px] text-muted-foreground">{note}</p>}
    </div>
  );
}

/**
 * Stats and charts. The page itself is cached for up to 20 minutes, so this reads Convex live
 * and only falls back to the cached numbers until the first answer arrives.
 */
export function AgentActivity({ slug, initial }: { slug: string; initial: { stats: Stats; daily: DailyPoint[] } }) {
  const live = useQuery(api.agentPage.activity, { slug });
  const { stats, daily } = live ?? initial;
  const latency = live?.latency;
  const hasRuns = stats.totalRuns > 0;
  const avgLatency = hasRuns ? Math.round(stats.totalLatencyMs / stats.totalRuns) : null;
  const successRate = hasRuns ? Math.round((stats.successRuns / stats.totalRuns) * 100) : null;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 rounded-xl border border-border divide-x divide-y sm:divide-y-0 divide-border overflow-hidden">
        <Stat label="Total runs" value={hasRuns ? stats.totalRuns.toLocaleString() : "0"} />
        <Stat
          label="Success"
          value={hasRuns ? stats.successRuns.toLocaleString() : "—"}
          note={successRate !== null ? `${successRate}% success rate` : undefined}
        />
        <Stat label="Failed" value={hasRuns ? stats.failedRuns.toLocaleString() : "—"} />
        <Stat
          label="Avg latency"
          value={avgLatency !== null ? `${(avgLatency / 1000).toFixed(avgLatency < 10_000 ? 1 : 0)} s` : "None"}
        />
      </div>

      {hasRuns ? (
        <AgentActivityCharts daily={daily} runs={latency} />
      ) : (
        <div className="rounded-xl border border-dashed border-border px-6 py-10 text-center">
          <p className="text-sm font-medium text-foreground">No runs before</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Nobody has called this agent yet, so you would be the first. Charts appear after the first run.
          </p>
        </div>
      )}
    </div>
  );
}
