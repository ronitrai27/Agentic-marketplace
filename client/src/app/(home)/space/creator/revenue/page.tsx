"use client";

import React, { useMemo, useState } from "react";
import { useQuery } from "convex/react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  XAxis,
  YAxis,
} from "recharts";
import { ArrowUpRight, CircleCheck, CircleX, Clock, Undo2 } from "lucide-react";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { api } from "../../../../../../convex/_generated/api";

/** 100 credits = $1, so one credit is 10,000 micro-USD. Fees are split server-side and stored per run. */
const MICROS_PER_CREDIT = 10_000;
const DAY_MS = 86_400_000;
const CHART_DAYS = 30;
const TABLE_LIMIT = 100;

type Range = "today" | "7d" | "30d";
const RANGES: Array<[Range, string]> = [
  ["today", "Today"],
  ["7d", "7 days"],
  ["30d", "30 days"],
];

const usd = (credits: number) =>
  (credits / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  });
const credits2 = (n: number) =>
  n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

type RunRow = NonNullable<
  ReturnType<typeof useQuery<typeof api.creatorRevenue.runs>>
>[number];
/** What the creator keeps, in credits. Refunded runs earn nothing. */
const earnedOf = (r: RunRow) =>
  r.status === "reversed" ? 0 : r.netMicros / MICROS_PER_CREDIT;
const creditsOf = (micros: number) => micros / MICROS_PER_CREDIT;
/** Local calendar day, so "today" means the creator's today. */
const dayKey = (t: number) => new Date(t).toLocaleDateString("en-CA");

const chartConfig = {
  earned: { label: "Earned", color: "var(--chart-2)" },
} satisfies ChartConfig;

const border = "border-neutral-300 dark:border-neutral-700";
const strong = "text-neutral-900 dark:text-neutral-50";
const soft = "text-neutral-700 dark:text-neutral-300";
const card = `rounded-lg border ${border} bg-white dark:bg-neutral-950`;
const cellLine = `border-r ${border} last:border-r-0`;

const HEADERS = [
  "Agent",
  "Latency",
  "Success",
  "Total credits",
  "Marketplace Fee",
  "Other Charges",
  "Money earned",
  "",
];

function timeLeft(at: number) {
  const mins = Math.max(1, Math.ceil((at - Date.now()) / 60_000));
  const h = Math.floor(mins / 60);
  const left =
    h >= 24
      ? `${Math.floor(h / 24)}d ${h % 24}h`
      : h > 0
        ? `${h}h ${mins % 60}m`
        : `${mins}m`;
  const when = new Date(at).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  return `${left} (${when})`;
}

/** The icon at the end of a row: on hold, in the wallet, or refunded. The tooltip says what it means. */
function StatusIcon({ r }: { r: RunRow }) {
  let icon: React.ReactNode = <span className={soft}>–</span>;
  let text = "No earnings: this run did not succeed, so nothing was charged.";

  if (r.status === "pending") {
    icon = <Clock className="size-4 text-amber-700 dark:text-amber-400" />;
    text = `On hold. ${usd(earnedOf(r))} reaches your wallet in ${timeLeft(r.availableAt ?? Date.now())}, then you can withdraw it.`;
  } else if (r.status === "available" || r.status === "paid") {
    icon = <ArrowUpRight className="size-4 text-green-700 dark:text-green-400" />;
    text = `Released. ${usd(earnedOf(r))} is in your wallet and can be withdrawn.`;
  } else if (r.status === "legacy") {
    icon = <Clock className={`size-4 ${soft}`} />;
    text = "Earned before wallet payouts existed. This amount was not added to your wallet.";
  } else if (r.status === "reversed") {
    icon = <Undo2 className={`size-4 ${soft}`} />;
    text = "Refunded. This run no longer counts towards your earnings.";
  }

  return (
    <Tooltip>
      <TooltipTrigger
        render={<span className="inline-flex cursor-default" />}
        aria-label={text}
      >
        {icon}
      </TooltipTrigger>
      <TooltipContent>{text}</TooltipContent>
    </Tooltip>
  );
}

export default function CreatorRevenuePage() {
  const runs = useQuery(api.creatorRevenue.runs);
  const [range, setRange] = useState<Range>("today");

  const { series, bars, total, pending } = useMemo(() => {
    const now = Date.now();
    const list = runs ?? [];

    // Last 30 days, one point per day
    const byDay = new Map<string, number>();
    for (const r of list)
      byDay.set(dayKey(r.at), (byDay.get(dayKey(r.at)) ?? 0) + earnedOf(r));
    const days = Array.from({ length: CHART_DAYS }, (_, i) => {
      const t = now - (CHART_DAYS - 1 - i) * DAY_MS;
      return {
        day: dayKey(t),
        label: new Date(t).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
        }),
        earned: (byDay.get(dayKey(t)) ?? 0) / 100,
      };
    });

    // Today: one bar per hour. 7 / 30 days: one bar per day.
    const todayKey = dayKey(now);
    const hours = Array.from({ length: 24 }, (_, h) => ({
      day: `${h}:00`,
      label: h % 6 === 0 ? `${h}:00` : `${h}`,
      earned: 0,
    }));
    for (const r of list)
      if (dayKey(r.at) === todayKey)
        hours[new Date(r.at).getHours()].earned += earnedOf(r) / 100;

    const bars =
      range === "today" ? hours : range === "7d" ? days.slice(-7) : days;
    const total = bars.reduce((s, b) => s + b.earned, 0) * 100;
    const pending = list
      .filter((r) => r.status === "pending")
      .reduce((s, r) => s + earnedOf(r), 0);
    return { series: days, bars, total, pending };
  }, [runs, range]);

  const loading = runs === undefined;
  const rows = (runs ?? []).slice(0, TABLE_LIMIT);

  return (
    <TooltipProvider>
      <div className="flex-1 h-full overflow-y-auto scrollbar-thin px-10 py-8 bg-background font-sans">
        <div className="max-w-7xl w-full mx-auto space-y-6">
          <div>
            <h1 className={`text-3xl font-semibold tracking-tight ${strong}`}>
              Revenue
            </h1>
            <p className={`text-sm mt-2 ${soft}`}>
              What your agents earned from every run. Track your earnings here.
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className={`${card} lg:col-span-2 p-4`}>
              <p className={`text-sm font-medium ${strong}`}>Money earned</p>
              <p className={`text-xs mt-0.5 ${soft}`}>Last 30 days</p>
              {loading ? (
                <Skeleton className="h-64 w-full rounded-lg mt-4" />
              ) : (
                <ChartContainer
                  config={chartConfig}
                  className="aspect-auto h-64 w-full mt-4"
                >
                  <AreaChart
                    data={series}
                    margin={{ left: 0, right: 8, top: 8 }}
                  >
                    <defs>
                      <linearGradient
                        id="earned-fill"
                        x1="0"
                        y1="0"
                        x2="0"
                        y2="1"
                      >
                        <stop offset="0%" stopColor="var(--color-earned)" />
                        <stop offset="100%" stopColor="var(--background)" />
                      </linearGradient>
                    </defs>
                    <CartesianGrid
                      vertical={false}
                      stroke="var(--color-neutral-300)"
                      strokeDasharray="3 3"
                    />
                    <XAxis
                      dataKey="label"
                      tickLine={false}
                      axisLine={false}
                      tickMargin={8}
                      minTickGap={32}
                    />
                    <YAxis
                      tickLine={false}
                      axisLine={false}
                      width={48}
                      tickFormatter={(v: number) => `$${v}`}
                    />
                    <ChartTooltip
                      cursor={false}
                      content={
                        <ChartTooltipContent
                          indicator="line"
                          className={border}
                          labelFormatter={(_, p) => p?.[0]?.payload?.day ?? ""}
                          formatter={(value) => (
                            <span
                              className={`font-medium tabular-nums ${strong}`}
                            >
                              Earned ${Number(value).toFixed(4)}
                            </span>
                          )}
                        />
                      }
                    />
                    <Area
                      dataKey="earned"
                      type="monotone"
                      stroke="var(--color-earned)"
                      strokeWidth={2}
                      fill="url(#earned-fill)"
                    />
                  </AreaChart>
                </ChartContainer>
              )}
            </div>

            <div className={`${card} p-4 flex flex-col`}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className={`text-sm font-medium ${strong}`}>
                    Revenue generated
                  </p>
                  <p className={`text-xs mt-0.5 ${soft}`}>After fees</p>
                </div>
                <Tabs
                  value={range}
                  onValueChange={(v) => setRange(v as Range)}
                >
                  <TabsList>
                    {RANGES.map(([value, label]) => (
                      <TabsTrigger
                        key={value}
                        value={value}
                        className="cursor-pointer px-2.5 text-xs"
                      >
                        {label}
                      </TabsTrigger>
                    ))}
                  </TabsList>
                </Tabs>
              </div>

              {loading ? (
                <Skeleton className="h-9 w-32 mt-4" />
              ) : (
                <p
                  className={`text-3xl font-semibold tracking-tight tabular-nums mt-4 ${strong}`}
                >
                  {usd(total)}
                </p>
              )}

              {loading ? (
                <Skeleton className="h-40 w-full mt-3" />
              ) : (
                <ChartContainer
                  config={chartConfig}
                  className="aspect-auto h-40 w-full mt-3"
                >
                  <BarChart data={bars} margin={{ left: 0, right: 0, top: 4 }}>
                    <CartesianGrid
                      vertical={false}
                      stroke="var(--color-neutral-300)"
                      strokeDasharray="3 3"
                    />
                    <XAxis
                      dataKey="label"
                      tickLine={false}
                      axisLine={false}
                      tickMargin={6}
                      interval="preserveStartEnd"
                      minTickGap={12}
                    />
                    <ChartTooltip
                      cursor={false}
                      content={
                        <ChartTooltipContent
                          indicator="line"
                          className={border}
                          labelFormatter={(_, p) => p?.[0]?.payload?.day ?? ""}
                          formatter={(value) => (
                            <span
                              className={`font-medium tabular-nums ${strong}`}
                            >
                              Earned ${Number(value).toFixed(4)}
                            </span>
                          )}
                        />
                      }
                    />
                    <Bar
                      dataKey="earned"
                      fill="var(--color-earned)"
                      radius={[4, 4, 0, 0]}
                    />
                  </BarChart>
                </ChartContainer>
              )}

              <p className={`text-xs mt-3 ${soft}`}>
                {loading
                  ? ""
                  : `${usd(pending)} on hold. Each run's earnings reach your wallet 48 hours later.`}
              </p>
            </div>
          </div>

          <div className={`${card} overflow-hidden`}>
            <div className={`px-4 py-3 border-b ${border}`}>
              <p className={`text-sm font-medium ${strong}`}>Runs</p>
            </div>
            <Table>
              <TableHeader>
                <TableRow className={`${border} hover:bg-transparent`}>
                  {HEADERS.map((h, i) => (
                    <TableHead
                      key={h || "status"}
                      className={`px-4 text-xs ${strong} ${cellLine} ${i >= 3 && i <= 6 ? "text-right" : ""} ${i === 7 ? "w-12" : ""}`}
                    >
                      {h}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading &&
                  [0, 1, 2, 3].map((i) => (
                    <TableRow key={i} className={border}>
                      <TableCell colSpan={8} className="px-4">
                        <Skeleton className="h-5 w-full" />
                      </TableCell>
                    </TableRow>
                  ))}
                {!loading && rows.length === 0 && (
                  <TableRow className="hover:bg-transparent">
                    <TableCell
                      colSpan={8}
                      className={`px-4 py-10 text-center text-sm ${soft}`}
                    >
                      No finished runs yet. Earnings show up here as soon as
                      buyers run your agents.
                    </TableCell>
                  </TableRow>
                )}
                {rows.map((r) => (
                  <TableRow key={r.id} className={border}>
                    <TableCell
                      className={`px-4 font-medium ${strong} ${cellLine}`}
                    >
                      {r.agentName}
                    </TableCell>
                    <TableCell
                      className={`px-4 tabular-nums ${strong} ${cellLine}`}
                    >
                      {r.latencyMs === null
                        ? "–"
                        : r.latencyMs >= 1000
                          ? `${(r.latencyMs / 1000).toFixed(2)} s`
                          : `${Math.round(r.latencyMs)} ms`}
                    </TableCell>
                    <TableCell className={`px-4 ${cellLine}`}>
                      {r.success ? (
                        <span className="inline-flex items-center gap-1.5 text-green-700 dark:text-green-400">
                          <CircleCheck className="size-4" /> Yes
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 text-red-700 dark:text-red-400">
                          <CircleX className="size-4" /> No
                        </span>
                      )}
                    </TableCell>
                    <TableCell
                      className={`px-4 text-right tabular-nums ${strong} ${cellLine}`}
                    >
                      {credits2(creditsOf(r.grossMicros))}
                    </TableCell>
                    <TableCell
                      className={`px-4 text-right tabular-nums ${soft} ${cellLine}`}
                    >
                      {credits2(creditsOf(r.commissionMicros))}
                    </TableCell>
                    <TableCell
                      className={`px-4 text-right tabular-nums ${soft} ${cellLine}`}
                    >
                      {credits2(creditsOf(r.platformFeeMicros))}
                    </TableCell>
                    <TableCell
                      className={`px-4 text-right font-medium tabular-nums ${strong} ${cellLine}`}
                    >
                      {usd(earnedOf(r))}
                    </TableCell>
                    <TableCell className={`px-4 ${cellLine}`}>
                      <StatusIcon r={r} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}
