"use client";

import React, { useMemo } from "react";
import { useQuery } from "convex/react";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { CircleCheck, CircleX } from "lucide-react";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { api } from "../../../../../../convex/_generated/api";

/** 100 credits = $1. Of every charge: 12% marketplace, 1% platform, the creator keeps the rest. */
const MARKETPLACE_RATE = 0.12;
const PLATFORM_RATE = 0.01;
const DAY_MS = 86_400_000;
const CHART_DAYS = 30;
const TABLE_LIMIT = 100;

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
const earnedOf = (c: number) => c * (1 - MARKETPLACE_RATE - PLATFORM_RATE);
const dayKey = (t: number) => new Date(t).toISOString().slice(0, 10);

const chartConfig = {
  earned: { label: "Earned", color: "var(--chart-2)" },
} satisfies ChartConfig;

const border = "border-neutral-300 dark:border-neutral-700";
const strong = "text-neutral-900 dark:text-neutral-50";
const soft = "text-neutral-700 dark:text-neutral-300";
const card = `rounded-lg border ${border} bg-white dark:bg-neutral-950`;

const HEADERS = [
  "Agent",
  "Time",
  "Latency",
  "Success",
  "Total credits",
  "Marketplace Fee",
  "Other Charges",
  "Money earned",
];

export default function CreatorRevenuePage() {
  const runs = useQuery(api.creatorRevenue.runs);

  const { series, today, week, month } = useMemo(() => {
    const now = Date.now();
    const list = runs ?? [];
    const byDay = new Map<string, number>();
    for (const r of list)
      byDay.set(
        dayKey(r.at),
        (byDay.get(dayKey(r.at)) ?? 0) + earnedOf(r.credits),
      );

    const series = Array.from({ length: CHART_DAYS }, (_, i) => {
      const t = now - (CHART_DAYS - 1 - i) * DAY_MS;
      return {
        day: dayKey(t),
        label: new Date(t).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          timeZone: "UTC",
        }),
        earned: (byDay.get(dayKey(t)) ?? 0) / 100,
      };
    });
    const sum = (days: number) =>
      list
        .filter((r) => r.at >= now - days * DAY_MS)
        .reduce((s, r) => s + earnedOf(r.credits), 0);
    const todayKey = dayKey(now);
    const today = list
      .filter((r) => dayKey(r.at) === todayKey)
      .reduce((s, r) => s + earnedOf(r.credits), 0);
    return { series, today, week: sum(7), month: sum(30) };
  }, [runs]);

  const loading = runs === undefined;
  const rows = (runs ?? []).slice(0, TABLE_LIMIT);
  const stats: Array<[string, number]> = [
    ["Today", today],
    ["7 days", week],
    ["30 days", month],
  ];

  return (
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
                <AreaChart data={series} margin={{ left: 0, right: 8, top: 8 }}>
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
            <p className={`text-sm font-medium ${strong}`}>Revenue generated</p>
            <p className={`text-xs mt-0.5 ${soft}`}>After fees</p>
            <div
              className={`flex-1 mt-4 flex flex-col divide-y divide-neutral-300 dark:divide-neutral-700`}
            >
              {stats.map(([label, value]) => (
                <div
                  key={label}
                  className="flex-1 flex flex-col justify-center py-3 first:pt-0 last:pb-0"
                >
                  <p className={`text-xs ${soft}`}>{label}</p>
                  {loading ? (
                    <Skeleton className="h-8 w-28 mt-1" />
                  ) : (
                    <p
                      className={`text-3xl font-semibold tracking-tight tabular-nums ${strong}`}
                    >
                      {usd(value)}
                    </p>
                  )}
                </div>
              ))}
            </div>
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
                    key={h}
                    className={`px-4 text-xs ${strong} ${i >= 4 ? "text-right" : ""}`}
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
                  <TableCell className={`px-4 font-medium ${strong}`}>
                    {r.agentName}
                  </TableCell>
                  <TableCell className={`px-4 ${soft}`}>
                    {new Date(r.at).toLocaleString("en-US", {
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </TableCell>
                  <TableCell className={`px-4 tabular-nums ${strong}`}>
                    {r.latencyMs === null
                      ? "–"
                      : r.latencyMs >= 1000
                        ? `${(r.latencyMs / 1000).toFixed(2)} s`
                        : `${Math.round(r.latencyMs)} ms`}
                  </TableCell>
                  <TableCell className="px-4">
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
                    className={`px-4 text-right tabular-nums ${strong}`}
                  >
                    {credits2(r.credits)}
                  </TableCell>
                  <TableCell className={`px-4 text-right tabular-nums ${soft}`}>
                    {credits2(r.credits * MARKETPLACE_RATE)}
                  </TableCell>
                  <TableCell className={`px-4 text-right tabular-nums ${soft}`}>
                    {credits2(r.credits * PLATFORM_RATE)}
                  </TableCell>
                  <TableCell
                    className={`px-4 text-right font-medium tabular-nums ${strong}`}
                  >
                    {usd(earnedOf(r.credits))}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}
