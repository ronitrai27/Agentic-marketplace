"use client";

import React from "react";
import { usePathname } from "next/navigation";
import { useQuery } from "convex/react";
import { toast } from "sonner";
import { api } from "../../../../../convex/_generated/api";
import { RunSheet } from "../agent-page/run-sheet";
import { closeRun, keepRunInUrl, openRun, startFromUrl, useOpenRunId } from "./run-store";

const fmtCredits = (n: number) => `${Number.isInteger(n) ? n : n.toFixed(2).replace(/0$/, "")} credits`;

/**
 * Toasts for run changes, wherever the buyer is in /space and whether or not the sheet is open. The first load only
 * records what already exists, so a refresh never replays old toasts.
 */
function useRunToasts() {
  const runs = useQuery(api.runs.myRecent);
  const wallet = useQuery(api.wallet.getWallet);
  const balance = React.useRef<number | null>(null);
  balance.current = wallet ? Math.round((wallet.credits - wallet.escrow) * 100) / 100 : null;
  const seen = React.useRef<Map<string, string> | null>(null);

  React.useEffect(() => {
    if (!runs) return;
    if (!seen.current) {
      seen.current = new Map(runs.map((r) => [r.id, r.status]));
      return;
    }
    for (const r of runs) {
      const before = seen.current.get(r.id);
      if (before === r.status) continue;
      seen.current.set(r.id, r.status);
      if (r.status === "awaiting_input" || r.status === "queued" || r.status === "cancelled") continue;

      if (r.status === "running") {
        toast.info(`${r.agentName} started running`, {
          description: "It keeps running if you close the panel or leave this page.",
          action: { label: "View", onClick: () => openRun(r.id) },
        });
      } else if (r.status === "succeeded") {
        const left = balance.current;
        toast.success(`${r.agentName} finished`, {
          description: `${fmtCredits(r.chargedCredits ?? 0)} deducted${left === null ? "" : ` · balance ${fmtCredits(left)}`}`,
          action: { label: "View", onClick: () => openRun(r.id) },
        });
      } else if (r.status === "failed") {
        toast.error(`${r.agentName} failed`, {
          description: r.errorMessage ?? "Nothing was charged.",
          action: { label: "View", onClick: () => openRun(r.id) },
        });
      }
    }
  }, [runs]);
}

/** Mounted once in the /space layout: owns the run sheet and the run toasts. */
export function RunSheetHost() {
  const runId = useOpenRunId();
  const pathname = usePathname();

  React.useEffect(() => startFromUrl(), []);
  React.useEffect(() => keepRunInUrl(), [pathname]);
  useRunToasts();

  return runId ? <RunSheet runId={runId} onClose={closeRun} /> : null;
}
