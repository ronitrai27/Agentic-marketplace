"use client";

import React from "react";
import Link from "next/link";
import { usePaginatedQuery } from "convex/react";
import {
  Ban,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleDashed,
  List,
  Search,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { Loupe } from "@lucasmarkes/hairline/react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  STRIPED_ROWS,
} from "@/components/ui/table";
import { api } from "../../../../../convex/_generated/api";
import { openRun } from "./run-store";

type Filter = "all" | "succeeded" | "failed" | "active" | "cancelled";

const PAGE_SIZE = 10;

const TABS: Array<{ value: Filter; label: string; icon: LucideIcon }> = [
  { value: "all", label: "All runs", icon: List },
  { value: "succeeded", label: "Succeeded", icon: CheckCircle2 },
  { value: "failed", label: "Failed", icon: XCircle },
  { value: "active", label: "In progress", icon: CircleDashed },
  { value: "cancelled", label: "Cancelled", icon: Ban },
];

const STATUS: Record<string, { label: string; tone: string; bar: string }> = {
  succeeded: {
    label: "Succeeded",
    tone: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
    bar: "bg-emerald-500",
  },
  failed: {
    label: "Failed",
    tone: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
    bar: "bg-red-500",
  },
  cancelled: {
    label: "Cancelled",
    tone: "bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300",
    bar: "bg-neutral-400",
  },
  queued: {
    label: "Queued",
    tone: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
    bar: "bg-amber-500",
  },
  running: {
    label: "Running",
    tone: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300",
    bar: "bg-blue-500",
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

function ago(t: number) {
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86_400)}d ago`;
}

function AgentLogo({ name, src }: { name: string; src: string | null }) {
  return src ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={name}
      className="size-8 shrink-0 rounded-lg object-cover"
    />
  ) : (
    <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-xs font-semibold text-muted-foreground">
      {name.trim().charAt(0).toUpperCase() || "?"}
    </span>
  );
}

export function RunsTable() {
  const [filter, setFilter] = React.useState<Filter>("all");
  const [search, setSearch] = React.useState("");
  const { results, status, loadMore } = usePaginatedQuery(
    api.runs.myAll,
    { filter },
    { initialNumItems: PAGE_SIZE * 2 },
  );
  const [page, setPage] = React.useState(0);

  const q = search.trim().toLowerCase();
  const rows = q
    ? results.filter((r) => r.agentName.toLowerCase().includes(q))
    : results;
  const loading = status === "LoadingFirstPage";

  const start = page * PAGE_SIZE;
  const pageRows = rows.slice(start, start + PAGE_SIZE);
  const hasNext = rows.length > start + PAGE_SIZE || status === "CanLoadMore";

  // Go back to page 1 whenever the filter or search changes.
  React.useEffect(() => setPage(0), [filter, q]);

  // Keep one page of look-ahead loaded so "Next" knows whether more rows exist.
  React.useEffect(() => {
    if (status === "CanLoadMore" && rows.length < start + PAGE_SIZE * 2) {
      loadMore(PAGE_SIZE * 2);
    }
  }, [status, rows.length, start, loadMore]);

  return (
    <div className="flex-1 h-full overflow-y-auto scrollbar-thin bg-background px-6 py-8 sm:px-10">
      <div className="mx-auto w-full max-w-7xl space-y-5">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-foreground">
            Runs
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Every agent run you have started, newest first.
          </p>
        </div>

        <div className="overflow-hidden rounded-lg border border-border">
          <div className="flex flex-wrap items-center justify-between gap-5 border-b border-border px-4 pt-3 pb-3">
            <Tabs value={filter} onValueChange={(v) => setFilter(v as Filter)}>
              <TabsList className="bg-neutral-200/70 dark:bg-neutral-800">
                {TABS.map((t) => (
                  <TabsTrigger
                    key={t.value}
                    value={t.value}
                    title={t.label}
                    className="gap-1.5 text-neutral-700 hover:text-neutral-950 data-active:bg-white data-active:text-neutral-950 dark:text-neutral-300 dark:hover:text-white dark:data-active:bg-neutral-950 dark:data-active:text-white"
                  >
                    <t.icon className="size-3.5 shrink-0" />
                    {t.label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
            <div className="relative w-full sm:w-64">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by agent"
                className="bg-white pl-8 dark:bg-input/30"
              />
            </div>
          </div>

          <Table>
            <TableHeader className="bg-neutral-100 dark:bg-neutral-900">
              <TableRow className="hover:bg-transparent">
                <TableHead className="text-xs">Agent</TableHead>
                <TableHead className="text-xs">Started</TableHead>
                <TableHead className="text-xs">Status</TableHead>
                <TableHead className="text-xs">Progress</TableHead>
                <TableHead className="text-xs text-right">Credits</TableHead>
                <TableHead className="text-xs">Result</TableHead>
                <TableHead className="text-xs text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className={STRIPED_ROWS}>
              {loading &&
                Array.from({ length: 6 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={7}>
                      <Skeleton className="h-8 w-full" />
                    </TableCell>
                  </TableRow>
                ))}

              {!loading &&
                pageRows.map((r) => {
                  const s = STATUS[r.status] ?? STATUS.cancelled;
                  const finished =
                    r.status === "succeeded" ||
                    r.status === "failed" ||
                    r.status === "cancelled";
                  const pct = finished
                    ? 100
                    : (r.progressPct ?? (r.status === "queued" ? 0 : 5));
                  return (
                    <TableRow key={r.id}>
                      <TableCell>
                        <div className="flex items-center gap-2.5">
                          <AgentLogo name={r.agentName} src={r.logoUrl} />
                          <div className="min-w-0">
                            {r.agentSlug ? (
                              <Link
                                href={`/space/marketplace/${r.agentSlug}`}
                                className="block max-w-48 truncate text-sm font-medium text-foreground hover:underline"
                              >
                                {r.agentName}
                              </Link>
                            ) : (
                              <span className="block max-w-48 truncate text-sm font-medium">
                                {r.agentName}
                              </span>
                            )}
                            <span className="text-[11px] text-muted-foreground">
                              #{r.id.slice(-6)}
                            </span>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <p className="text-xs text-foreground">
                          {fmtWhen(r.createdAt)}
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                          {ago(r.createdAt)}
                        </p>
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary" className={s.tone}>
                          {s.label}
                        </Badge>
                      </TableCell>
                      <TableCell className="min-w-40">
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                            <div
                              className={`h-full rounded-full ${s.bar}`}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                          <span className="w-9 text-right text-[11px] tabular-nums text-muted-foreground">
                            {Math.round(pct)}%
                          </span>
                        </div>
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          {finished
                            ? `Took ${fmtDuration(r.durationMs)}`
                            : "In progress"}
                        </p>
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
                          variant="outline"
                          size="sm"
                          onClick={() => openRun(r.id)}
                        >
                          View <ChevronRight className="size-3.5" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
            </TableBody>
          </Table>

          {!loading && rows.length === 0 && (
            <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
              <div className="w-56 max-w-full">
                <Loupe />
              </div>
              <p className="text-sm text-muted-foreground">
                {q || filter !== "all"
                  ? "No runs match."
                  : "No runs yet. Run an agent from the marketplace."}
              </p>
            </div>
          )}

          <div className="flex items-center justify-between border-t border-border px-4 py-3 text-xs text-muted-foreground">
            <span>
              {rows.length === 0
                ? "0 runs"
                : `${start + 1}–${start + pageRows.length}${hasNext ? "" : ` of ${rows.length}`}`}
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="icon-sm"
                aria-label="Previous page"
                disabled={page === 0}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
              >
                <ChevronLeft className="size-4" />
              </Button>
              <span className="min-w-14 text-center tabular-nums">
                Page {page + 1}
              </span>
              <Button
                variant="outline"
                size="icon-sm"
                aria-label="Next page"
                disabled={!hasNext || status === "LoadingMore"}
                onClick={() => setPage((p) => p + 1)}
              >
                <ChevronRight className="size-4" />
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
