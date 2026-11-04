"use client";

import { useQuery } from "convex/react";
import { Activity } from "lucide-react";
import { api } from "../../../../../convex/_generated/api";
import { openRun } from "./run-store";

export const ACTIVE_STATUSES = ["awaiting_input", "queued", "running"];

const label = (status: string) => (status === "awaiting_input" ? "Needs your input" : "Running…");

/** Runs still going (for the sidebar). */
export function useActiveRuns() {
  const runs = useQuery(api.runs.myRecent);
  return (runs ?? []).filter((r) => ACTIVE_STATUSES.includes(r.status));
}

/** Activity icon shown at the right end of "Recent Runs" while any agent runs. */
export function ActiveRunsIndicator({ count }: { count: number }) {
  if (count === 0) return null;
  return <Activity className="ml-auto size-4 shrink-0 animate-pulse text-emerald-600" strokeWidth={2} aria-label="Agent running" />;
}

/** Sub-list under "Recent Runs" in the sidebar. Click opens the run sheet. */
export function ActiveRunsList({ runs }: { runs: ReturnType<typeof useActiveRuns> }) {
  if (runs.length === 0) return null;
  return (
    <div className="ml-6 mt-0.5 flex flex-col gap-0.5 border-l border-neutral-300 pl-2 group-data-[collapsible=icon]:hidden dark:border-neutral-700">
      {runs.map((run) => (
        <button
          key={run.id}
          type="button"
          onClick={() => openRun(run.id)}
          className="flex w-full cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-left text-xs hover:bg-black/5 dark:hover:bg-white/10"
        >
          <span
            className={`size-1.5 shrink-0 rounded-full ${run.status === "awaiting_input" ? "bg-amber-500" : "animate-pulse bg-emerald-500"}`}
          />
          <span className="min-w-0 truncate font-medium text-foreground">{run.agentName}</span>
          <span className="shrink-0 text-muted-foreground">{label(run.status)}</span>
        </button>
      ))}
    </div>
  );
}
