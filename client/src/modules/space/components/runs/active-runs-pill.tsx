"use client";

import React from "react";
import { useQuery } from "convex/react";
import { ChevronDown } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { api } from "../../../../../convex/_generated/api";
import { openRun } from "./run-store";

export const ACTIVE_STATUSES = ["awaiting_input", "queued", "running"];

const label = (status: string) => (status === "awaiting_input" ? "Needs your input" : "Running");

/** Header shortcut to any run still going. Click opens its sheet, from any page in /space. */
export function ActiveRunsPill() {
  const runs = useQuery(api.runs.myRecent);
  const [open, setOpen] = React.useState(false);
  const wrap = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  const active = (runs ?? []).filter((r) => ACTIVE_STATUSES.includes(r.status));
  if (active.length === 0) return null;

  const pill =
    "inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-sm border border-neutral-200 bg-background px-2.5 text-xs font-medium text-foreground shadow-2xs transition-colors hover:bg-neutral-50 dark:border-neutral-800 dark:hover:bg-neutral-900";

  if (active.length === 1) {
    const run = active[0];
    return (
      <button type="button" className={pill} onClick={() => openRun(run.id)}>
        {run.status === "awaiting_input" ? <span className="size-2 rounded-full bg-amber-500" /> : <Spinner className="size-3.5" />}
        <span className="max-w-40 truncate">{run.agentName}</span>
        <span className="text-muted-foreground">· {label(run.status)}</span>
      </button>
    );
  }

  return (
    <div ref={wrap} className="relative">
      <button type="button" className={pill} onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <Spinner className="size-3.5" />
        {active.length} runs active
        <ChevronDown className="size-3.5 text-muted-foreground" />
      </button>
      {open && (
        <div className="absolute right-0 top-10 z-50 w-64 rounded-lg border border-border bg-popover p-1 shadow-lg">
          {active.map((run) => (
            <button
              key={run.id}
              type="button"
              onClick={() => {
                setOpen(false);
                openRun(run.id);
              }}
              className="flex w-full cursor-pointer items-center justify-between gap-3 rounded-md px-2.5 py-2 text-left text-xs hover:bg-muted"
            >
              <span className="min-w-0 truncate font-medium">{run.agentName}</span>
              <span className="shrink-0 text-muted-foreground">{label(run.status)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
