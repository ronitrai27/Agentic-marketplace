"use client";

import React from "react";
import { useQuery } from "convex/react";
import { History, LayoutList } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { api } from "../../../../../convex/_generated/api";
import { openRun } from "../runs/run-store";

const STATUS: Record<string, { label: string; tone: string }> = {
  succeeded: {
    label: "Succeeded",
    tone: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  },
  failed: {
    label: "Failed",
    tone: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
  },
  cancelled: {
    label: "Cancelled",
    tone: "bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300",
  },
  queued: {
    label: "Queued",
    tone: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  },
  running: {
    label: "Running",
    tone: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300",
  },
};

const fmtCredits = (n: number) =>
  `${Number.isInteger(n) ? n : n.toFixed(2).replace(/0$/, "")}`;

function fmtDuration(ms: number | null) {
  if (ms === null) return "—";
  if (ms < 1000) return `${ms} ms`;
  const s = Math.round(ms / 1000);
  return s < 60
    ? `${s}s`
    : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
}

const fmtWhen = (t: number) =>
  new Date(t).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

/**
 * "Details | History" switch under Pricing. History only exists for buyers who have run this agent; while it is
 * selected it replaces the agent details with a table of their runs.
 */
export function AgentHistoryGate({
  slug,
  children,
}: {
  slug: string;
  children: React.ReactNode;
}) {
  const runs = useQuery(api.runs.myForAgent, { slug });
  const [showHistory, setShowHistory] = React.useState(false);
  const hasHistory = (runs?.length ?? 0) > 0;
  const history = hasHistory && showHistory;

  return (
    <>
      {hasHistory && (
        <div className="flex gap-5 border-t border-border pt-5">
          <Button
            variant={history ? "outline" : "default"}
            size="sm"
            onClick={() => setShowHistory(false)}
          >
            <LayoutList className="size-3.5" /> Details
          </Button>
          <Button
            variant={history ? "default" : "outline"}
            size="sm"
            onClick={() => setShowHistory(true)}
          >
            <History className="size-3.5" /> History
          </Button>
        </div>
      )}

      {history ? (
        <section className=" py-4 mt-5">
          <div className="overflow-hidden rounded-lg border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Status</TableHead>
                  <TableHead className="text-xs">Started</TableHead>
                  <TableHead className="text-xs">Duration</TableHead>
                  <TableHead className="text-xs text-right">Credits</TableHead>
                  <TableHead className="text-xs">Result</TableHead>
                  <TableHead className="text-xs text-right" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {runs?.map((r) => {
                  const s = STATUS[r.status] ?? STATUS.cancelled;
                  return (
                    <TableRow key={r.id}>
                      <TableCell>
                        <Badge variant="secondary" className={s.tone}>
                          {s.label}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {fmtWhen(r.createdAt)}
                      </TableCell>
                      <TableCell className="text-xs tabular-nums">
                        {fmtDuration(r.durationMs)}
                      </TableCell>
                      <TableCell className="text-right text-xs tabular-nums">
                        {r.holdStatus === "settled"
                          ? `${fmtCredits(r.chargedCredits ?? 0)} charged`
                          : r.holdStatus === "released"
                            ? "Released"
                            : r.holdStatus === "held"
                              ? `${fmtCredits(r.holdCredits ?? 0)} held`
                              : "—"}
                      </TableCell>
                      <TableCell className="max-w-56 truncate text-xs text-muted-foreground">
                        {r.errorMessage ??
                          (r.status === "succeeded" ? "Completed" : "—")}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => openRun(r.id)}
                        >
                          View
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </section>
      ) : (
        children
      )}
    </>
  );
}
