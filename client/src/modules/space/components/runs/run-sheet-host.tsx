"use client";

import React from "react";
import { usePathname } from "next/navigation";
import { useQuery } from "convex/react";
import { toast } from "sonner";
import { api } from "../../../../../convex/_generated/api";
import { EmptyRunSheet, RunSheet } from "../agent-page/run-sheet";
import { EMPTY_RUN, clearRun, closeRun, keepRunInUrl, openRun, startFromUrl, toggleRun, useOpenRunId } from "./run-store";

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
      if (r.status === "awaiting_input" || r.status === "queued") continue;
      const released = r.holdStatus === "released" && r.holdCredits ? ` ${fmtCredits(r.holdCredits)} released back to your wallet.` : " Nothing was charged.";

      if (r.status === "cancelled") {
        if (r.errorCode) {
          toast.warning(`${r.agentName} run expired`, {
            description: `${r.errorMessage ?? "The run was cancelled."}${released}`,
            action: { label: "View", onClick: () => openRun(r.id) },
          });
        }
        continue;
      }

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
        toast.error(r.errorCode === "TIMEOUT" ? `${r.agentName} timed out` : `${r.agentName} failed`, {
          description: `${r.errorMessage ?? "The agent could not finish this run."}${released}`,
          duration: 10000,
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

  // Ctrl/Cmd+Shift+B toggles the run sheet (Ctrl+K is the header search)
  const recent = useQuery(api.runs.myRecent);
  const latestId = (recent?.find((r) => r.status === "running" || r.status === "queued") ?? recent?.[0])?.id;
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "b") {
        e.preventDefault();
        toggleRun(latestId);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [latestId]);

  if (!runId) return null;
  return runId === EMPTY_RUN ? (
    <EmptyRunSheet onClose={closeRun} />
  ) : (
    <RunSheet runId={runId} onClose={closeRun} onClear={clearRun} />
  );
}
