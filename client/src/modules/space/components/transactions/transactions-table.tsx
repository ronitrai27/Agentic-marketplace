"use client";

import React from "react";
import { useQuery } from "convex/react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  Search,
  Wallet,
} from "lucide-react";
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

type Range = "1d" | "7d" | "1m" | "1y" | "all";
type Tx = NonNullable<
  ReturnType<typeof useQuery<typeof api.transactions.myList>>
>["rows"][number];

const RANGES: Array<{ value: Range; label: string }> = [
  { value: "1d", label: "1D" },
  { value: "7d", label: "7D" },
  { value: "1m", label: "1M" },
  { value: "1y", label: "1Y" },
  { value: "all", label: "All" },
];

const PAGE_SIZE = 10;

const CATEGORY: Record<Tx["type"], string> = {
  topup: "Top Up",
  withdrawal: "Withdraw",
  run_charge: "Agent Run",
  run_earning: "Earning",
  earning_reversal: "Reversal",
};

const STATUS: Record<Tx["status"], { label: string; tone: string }> = {
  success: {
    label: "Success",
    tone: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  },
  pending: {
    label: "Pending",
    tone: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  },
  failed: {
    label: "Failed",
    tone: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
  },
};

const fmtCredits = (n: number) =>
  Number.isInteger(n) ? n.toLocaleString() : n.toFixed(2).replace(/0$/, "");
const usd = (credits: number) => `$${(credits / 100).toFixed(2)}`;

const fmtDate = (t: number) =>
  new Date(t).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

/** What the row is about: the agent for run rows, a wallet icon for top-ups and withdrawals. */
function Avatar({ tx }: { tx: Tx }) {
  if (tx.runId) {
    return tx.agentLogoUrl ? (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={tx.agentLogoUrl}
        alt={tx.agentName ?? "Agent"}
        className="size-9 shrink-0 rounded-lg object-cover"
      />
    ) : (
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-xs font-semibold text-muted-foreground">
        {(tx.agentName ?? "?").trim().charAt(0).toUpperCase() || "?"}
      </span>
    );
  }
  return (
    <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
      <Wallet className="size-4" />
    </span>
  );
}

function titleOf(tx: Tx) {
  if (tx.runId) return tx.agentName ?? "Deleted agent";
  return tx.type === "topup" ? "Wallet top-up" : "Wallet withdrawal";
}

function subtitleOf(tx: Tx) {
  switch (tx.type) {
    case "run_charge":
      return tx.via ? `Run via ${tx.via} (MCP)` : "Run charge";
    case "run_earning":
      return tx.status === "pending" ? "Earning, clears in 48h" : "Run earning";
    case "earning_reversal":
      return tx.note ? `Refunded: ${tx.note}` : "Earning reversed";
    case "topup":
      return "PayPal";
    case "withdrawal":
      return "PayPal payout";
  }
}

function reference(tx: Tx) {
  if (tx.ref) return tx.ref;
  if (tx.runId) return `run #${tx.runId.slice(-6)}`;
  return "-";
}

/** Decorative wave lines on the right edge of a stat card. */
function Waves({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 200 100"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      className={`pointer-events-none absolute -right-2 bottom-0 h-full w-52 opacity-25 ${className ?? ""}`}
    >
      <path d="M0 80 C30 40 60 100 100 60 S170 20 200 50" />
      <path d="M0 90 C30 55 60 105 100 72 S170 35 200 62" opacity=".7" />
      <path d="M0 100 C30 70 60 110 100 85 S170 50 200 75" opacity=".5" />
      <circle cx="165" cy="28" r="14" opacity=".6" />
      <circle cx="165" cy="28" r="26" opacity=".3" />
    </svg>
  );
}

export function TransactionsTable() {
  const [range, setRange] = React.useState<Range>("1y");
  const [search, setSearch] = React.useState("");
  const [page, setPage] = React.useState(1);
  const data = useQuery(api.transactions.myList, { range });

  const q = search.trim().toLowerCase();
  const rows = React.useMemo(() => {
    const all = data?.rows ?? [];
    if (!q) return all;
    return all.filter((t) =>
      [titleOf(t), CATEGORY[t.type], reference(t), STATUS[t.status].label, t.via ?? ""]
        .join(" ")
        .toLowerCase()
        .includes(q),
    );
  }, [data, q]);

  const loading = data === undefined;
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const current = Math.min(page, pages);
  const start = (current - 1) * PAGE_SIZE;
  const visible = rows.slice(start, start + PAGE_SIZE);

  return (
    <div className="flex-1 h-full overflow-y-auto scrollbar-thin bg-background px-6 py-8 sm:px-10">
      <div className="mx-auto flex min-h-full w-full max-w-7xl flex-col gap-5">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-foreground">
            Transactions
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Every credit that enters or leaves your wallet: top-ups,
            withdrawals, agent runs and earnings.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="relative overflow-hidden rounded-xl border border-neutral-300 bg-linear-to-br from-white via-neutral-100 to-neutral-200 p-5 dark:border-neutral-700 dark:from-neutral-950 dark:via-neutral-900 dark:to-neutral-800">
            <Waves className="text-emerald-600" />
            <div className="relative z-10">
              <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                <ArrowDownLeft className="size-3.5 text-emerald-600" /> Credited
              </div>
              <div className="mt-2 text-3xl font-semibold tracking-tight">
                {loading ? "-" : `+${fmtCredits(data.creditedCredits)}`}
                <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                  credits {data ? `(${usd(data.creditedCredits)})` : ""}
                </span>
              </div>
            </div>
          </div>
          <div className="relative overflow-hidden rounded-xl border border-neutral-300 bg-linear-to-br from-white via-neutral-100 to-neutral-200 p-5 dark:border-neutral-700 dark:from-neutral-950 dark:via-neutral-900 dark:to-neutral-800">
            <Waves className="text-red-600" />
            <div className="relative z-10">
              <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                <ArrowUpRight className="size-3.5 text-red-600" /> Debited
              </div>
              <div className="mt-2 text-3xl font-semibold tracking-tight">
                {loading ? "-" : `-${fmtCredits(data.debitedCredits)}`}
                <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                  credits {data ? `(${usd(data.debitedCredits)})` : ""}
                </span>
              </div>
            </div>
          </div>
        </div>

        <div className="flex flex-1 flex-col overflow-hidden rounded-lg border border-neutral-300 dark:border-neutral-700">
          <div className="flex flex-wrap items-center justify-between gap-5 border-b border-neutral-300 px-4 py-3 dark:border-neutral-700">
            <h2 className="text-sm font-semibold">Transactions History</h2>
            <div className="flex w-full flex-wrap items-center gap-3 sm:w-auto">
              <div className="relative w-full sm:w-64">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setPage(1);
                  }}
                  placeholder="Search"
                  className="bg-white pl-8 dark:bg-input/30"
                />
              </div>
              <Tabs
                value={range}
                onValueChange={(v) => {
                  setRange(v as Range);
                  setPage(1);
                }}
              >
                <TabsList className="bg-neutral-200/70 dark:bg-neutral-800">
                  {RANGES.map((r) => (
                    <TabsTrigger
                      key={r.value}
                      value={r.value}
                      className="text-neutral-700 hover:text-neutral-950 data-active:bg-white data-active:text-neutral-950 dark:text-neutral-300 dark:hover:text-white dark:data-active:bg-neutral-950 dark:data-active:text-white"
                    >
                      {r.label}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>
            </div>
          </div>

          <div className="flex-1"><Table className="[&_th]:border-r [&_td]:border-r [&_th]:border-neutral-300 [&_td]:border-neutral-300 [&_th:last-child]:border-r-0 [&_td:last-child]:border-r-0 [&_th]:bg-neutral-100 [&_tr]:border-neutral-300 dark:[&_th]:border-neutral-700 dark:[&_td]:border-neutral-700 dark:[&_tr]:border-neutral-700 dark:[&_th]:bg-neutral-900">
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs">Description</TableHead>
                <TableHead className="text-xs">Category</TableHead>
                <TableHead className="text-xs">Date</TableHead>
                <TableHead className="text-xs">Reference</TableHead>
                <TableHead className="text-xs">Status</TableHead>
                <TableHead className="text-xs text-right">Amount</TableHead>
                <TableHead className="text-xs text-right">Balance</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className={`${STRIPED_ROWS} [&_tr:last-child]:border-b!`}>
              {loading &&
                Array.from({ length: 6 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={7}>
                      <Skeleton className="h-9 w-full" />
                    </TableCell>
                  </TableRow>
                ))}

              {!loading &&
                visible.map((t) => {
                  const s = STATUS[t.status];
                  const credit = t.direction === "credit";
                  return (
                    <TableRow key={t.id}>
                      <TableCell>
                        <div className="flex items-center gap-2.5">
                          <Avatar tx={t} />
                          <div className="min-w-0">
                            <span className="block max-w-56 truncate text-sm font-medium text-foreground">
                              {titleOf(t)}
                            </span>
                            <span className="block max-w-56 truncate text-[11px] text-muted-foreground">
                              {subtitleOf(t)}
                            </span>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-sm">
                        {CATEGORY[t.type]}
                      </TableCell>
                      <TableCell className="text-sm">
                        {fmtDate(t.createdAt)}
                      </TableCell>
                      <TableCell className="max-w-40 truncate font-mono text-xs text-muted-foreground">
                        {reference(t)}
                      </TableCell>
                      <TableCell>
                        <span
                          className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${s.tone}`}
                        >
                          {s.label}
                        </span>
                      </TableCell>
                      <TableCell
                        className={`text-right text-sm font-semibold tabular-nums ${
                          t.status === "failed"
                            ? "text-muted-foreground line-through"
                            : credit
                              ? "text-emerald-600"
                              : "text-foreground"
                        }`}
                      >
                        {credit ? "+" : "-"}
                        {fmtCredits(t.credits)}
                        <span className="ml-1 text-[11px] font-normal text-muted-foreground">
                          cr
                        </span>
                      </TableCell>
                      <TableCell className="text-right text-sm tabular-nums text-muted-foreground">
                        {t.balanceAfter === null
                          ? "-"
                          : fmtCredits(t.balanceAfter)}
                      </TableCell>
                    </TableRow>
                  );
                })}

              {!loading && rows.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={7}
                    className="py-12 text-center text-sm text-muted-foreground"
                  >
                    {q
                      ? "No transactions match your search."
                      : "No transactions in this period yet."}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table></div>

          {!loading && rows.length > 0 && (
            <div className="mt-auto flex flex-wrap items-center justify-between gap-3 border-t border-neutral-300 px-4 py-3 dark:border-neutral-700 text-sm text-muted-foreground">
              <span>
                Showing{" "}
                <strong className="text-foreground">
                  {start + 1}-{start + visible.length}
                </strong>{" "}
                of <strong className="text-foreground">{rows.length}</strong>{" "}
                entries
                {data?.truncated ? " (latest 500)" : ""}
              </span>
              <div className="flex items-center gap-1.5">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={current <= 1}
                  onClick={() => setPage(current - 1)}
                >
                  <ChevronLeft className="size-4" /> Previous
                </Button>
                <span className="px-2 text-foreground">
                  {current} / {pages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={current >= pages}
                  onClick={() => setPage(current + 1)}
                >
                  Next <ChevronRight className="size-4" />
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
