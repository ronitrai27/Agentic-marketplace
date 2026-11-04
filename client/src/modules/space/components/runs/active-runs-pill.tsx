"use client";

import Link from "next/link";
import { useQuery } from "convex/react";
import { Activity } from "lucide-react";
import { api } from "../../../../../convex/_generated/api";
import { openRun } from "./run-store";

export const ACTIVE_STATUSES = ["awaiting_input", "queued", "running"];

type RecentRun = NonNullable<ReturnType<typeof useRecentRuns>>[number];

export function useRecentRuns() {
  return useQuery(api.runs.myRecent);
}

/** Runs still going, and the latest finished ones, for the sidebar. */
export function useSidebarRuns() {
  const runs = useRecentRuns() ?? [];
  return {
    active: runs.filter((r) => ACTIVE_STATUSES.includes(r.status)),
    finished: runs
      .filter((r) => !ACTIVE_STATUSES.includes(r.status))
      .slice(0, 4),
  };
}

function AgentLogo({ run }: { run: RecentRun }) {
  return run.logoUrl ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={run.logoUrl}
      alt=""
      className="size-5 shrink-0 rounded-md object-cover"
    />
  ) : (
    <span className="flex size-5 shrink-0 items-center justify-center rounded-md bg-neutral-200 text-[10px] font-semibold text-neutral-700 dark:bg-neutral-800 dark:text-neutral-200">
      {run.agentName.slice(0, 1).toUpperCase()}
    </span>
  );
}

/** Pulsing activity icon at the right end of "Recent Runs" while any agent runs. */
export function ActiveRunsIndicator({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <Activity
      className="ml-auto mr-5 size-4 shrink-0 animate-pulse text-emerald-600"
      strokeWidth={2}
      aria-label="Agent running"
    />
  );
}

/** Running agents under "Recent Runs": logo, name and a live progress bar. Click opens the run sheet. */
export function ActiveRunsList({ runs }: { runs: RecentRun[] }) {
  if (runs.length === 0) return null;
  return (
    <div className="flex flex-col gap-1">
      {runs.map((run) => {
        const waiting = run.status === "awaiting_input";
        const pct = run.progressPct;
        return (
          <button
            key={run.id}
            type="button"
            onClick={() => openRun(run.id)}
            className="flex w-full cursor-pointer flex-col gap-1.5  px-2.5 py-2 text-left "
          >
            <span className="flex items-center gap-2">
              <AgentLogo run={run} />
              <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">
                {run.agentName}
              </span>
              <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
                {waiting
                  ? "Needs input"
                  : typeof pct === "number"
                    ? `${Math.round(pct)}%`
                    : "Running…"}
              </span>
            </span>
            <span className="h-1 w-full overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800">
              <span
                className={`block h-full rounded-full transition-[width] duration-500 ${
                  waiting
                    ? "w-full bg-amber-400"
                    : typeof pct === "number"
                      ? "bg-blue-500"
                      : "w-1/3 animate-pulse bg-blue-500"
                }`}
                style={
                  !waiting && typeof pct === "number"
                    ? { width: `${Math.max(3, pct)}%` }
                    : undefined
                }
              />
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** Latest finished runs (top 4): green = succeeded, red = failed or aborted. Opened by the chevron. */
export function RecentRunsList({ runs, active }: { runs: RecentRun[]; active: RecentRun[] }) {
  return (
    <div className="mt-1 flex flex-col gap-0.5 border-l border-neutral-400 pl-2 ml-5 group-data-[collapsible=icon]:hidden dark:border-neutral-700">
      {runs.length === 0 && active.length === 0 && (
        <p className="px-2 py-1 text-xs text-muted-foreground">No runs yet</p>
      )}
      {runs.map((run) => (
        <button
          key={run.id}
          type="button"
          onClick={() => openRun(run.id)}
          className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-left text-xs hover:bg-black/5 dark:hover:bg-white/10"
        >
          <span
            className={`size-1.5 shrink-0 rounded-full ${run.status === "succeeded" ? "bg-emerald-500" : "bg-red-500"}`}
          />
          <span className="min-w-0 truncate text-foreground">
            {run.agentName}
          </span>
        </button>
      ))}
      <ActiveRunsList runs={active} />
      <Link
        href="/space/runs"
        className="rounded-md px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-black/5 hover:text-foreground dark:hover:bg-white/10"
      >
        View all
      </Link>
    </div>
  );
}
