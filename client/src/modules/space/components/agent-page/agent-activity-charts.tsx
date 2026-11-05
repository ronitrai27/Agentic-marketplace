"use client";

import React, { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Scatter, ScatterChart, XAxis, YAxis, ZAxis } from "recharts";
import { ChartContainer, ChartTooltip, type ChartConfig } from "@/components/ui/chart";

export interface DailyPoint {
  day: string;
  totalRuns: number;
  successRuns: number;
  failedRuns: number;
  totalLatencyMs: number;
}

const RANGES = [7, 30, 45] as const;
type Range = (typeof RANGES)[number];

const GREEN = "oklch(0.84 0.24 128)";
const GREEN_LINE = "oklch(0.7 0.22 130)";
const RED = "oklch(0.68 0.21 25)";
const BLUE = "oklch(0.65 0.19 255)";

const runsConfig = {
  successRuns: { label: "Success", color: GREEN },
  failedRuns: { label: "Failed", color: RED },
} satisfies ChartConfig;

const latencyConfig = {
  avgMs: { label: "Avg latency", color: BLUE },
} satisfies ChartConfig;

const dayStr = (offsetFromToday: number) => new Date(Date.now() - offsetFromToday * 86_400_000).toISOString().slice(0, 10);

/** `days` days ending today, quiet days filled with zeros so the axis is continuous. `back` shifts the window into the past. */
function window(daily: DailyPoint[], days: number, back = 0) {
  const byDay = new Map(daily.map((d) => [d.day, d]));
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const day = dayStr(i + back);
    const d = byDay.get(day);
    out.push({
      x: days - 1 - i,
      day,
      label: day.slice(5),
      totalRuns: d?.totalRuns ?? 0,
      successRuns: d?.successRuns ?? 0,
      failedRuns: d?.failedRuns ?? 0,
      latencyMs: d?.totalLatencyMs ?? 0,
      avgMs: d && d.totalRuns > 0 ? Math.round(d.totalLatencyMs / d.totalRuns) : null,
    });
  }
  return out;
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const fmtSec = (ms: number) => (ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`);

function pctChange(now: number, before: number): number | null {
  if (before <= 0) return null;
  return ((now - before) / before) * 100;
}

function Delta({ pct, goodWhenDown = false }: { pct: number | null; goodWhenDown?: boolean }) {
  if (pct === null || !Number.isFinite(pct)) return null;
  const up = pct >= 0;
  const good = goodWhenDown ? !up : up;
  return (
    <span
      className={`rounded-md px-2 py-0.5 text-sm font-medium ${
        good
          ? "bg-lime-200 text-lime-900 dark:bg-lime-950 dark:text-lime-300"
          : "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300"
      }`}
    >
      {up ? "+" : ""}
      {pct.toFixed(1)}%
    </span>
  );
}

function RangePicker({ value, onChange }: { value: Range; onChange: (r: Range) => void }) {
  return (
    <div className="inline-flex rounded-lg bg-background p-0.5 shadow-2xs ring-1 ring-border">
      {RANGES.map((r) => (
        <button
          key={r}
          type="button"
          onClick={() => onChange(r)}
          className={`cursor-pointer rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
            value === r ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {r}d
        </button>
      ))}
    </div>
  );
}

function LegendCard({ color, label, value }: { color: string; label: string; value: string }) {
  return (
    <div className="min-w-0 flex-1 rounded-xl bg-background px-3.5 py-2.5 shadow-2xs ring-1 ring-border/60">
      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className="size-2.5 shrink-0 rounded-[3px]" style={{ background: color }} />
        <span className="truncate">{label}</span>
      </p>
      <p className="mt-0.5 text-sm font-semibold tabular-nums text-foreground">{value}</p>
    </div>
  );
}

function Card({
  title,
  value,
  delta,
  range,
  onRange,
  children,
  legend,
}: {
  title: string;
  value: string;
  delta: React.ReactNode;
  range: Range;
  onRange: (r: Range) => void;
  children: React.ReactNode;
  legend: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl bg-muted/50 p-4 ring-1 ring-border/50">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm text-muted-foreground">{title}</p>
          <p className="mt-1 flex items-center gap-2.5 text-3xl font-semibold tracking-tight tabular-nums text-foreground">
            {value}
            {delta}
          </p>
        </div>
        <RangePicker value={range} onChange={onRange} />
      </div>
      <div className="mt-4">{children}</div>
      <div className="mt-3 flex gap-2.5">{legend}</div>
    </div>
  );
}

function Tip({ active, payload, render }: { active?: boolean; payload?: any[]; render: (p: any) => React.ReactNode }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg bg-background px-3 py-2 text-xs shadow-lg ring-1 ring-border">{render(payload[0].payload)}</div>
  );
}

export function AgentActivityCharts({ daily }: { daily: DailyPoint[] }) {
  const [range, setRange] = useState<Range>(30);

  const data = useMemo(() => window(daily, range), [daily, range]);
  const prev = useMemo(() => window(daily, range, range), [daily, range]);

  const runs = sum(data.map((d) => d.totalRuns));
  const success = sum(data.map((d) => d.successRuns));
  const failed = sum(data.map((d) => d.failedRuns));
  const prevRuns = sum(prev.map((d) => d.totalRuns));

  const avgNow = runs > 0 ? sum(data.map((d) => d.latencyMs)) / runs : 0;
  const prevAvg = prevRuns > 0 ? sum(prev.map((d) => d.latencyMs)) / prevRuns : 0;
  const points = data.filter((d) => d.avgMs !== null) as Array<(typeof data)[number] & { avgMs: number }>;
  const fastest = points.length ? Math.min(...points.map((p) => p.avgMs)) : null;
  const slowest = points.length ? Math.max(...points.map((p) => p.avgMs)) : null;

  const tickEvery = range === 7 ? 1 : range === 30 ? 6 : 8;
  const ticks = data.filter((d) => d.x % tickEvery === 0 || d.x === range - 1).map((d) => d.x);
  const healthy = points.filter((p) => p.failedRuns === 0);
  const hadFailures = points.filter((p) => p.failedRuns > 0);

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card
        title={`Runs · last ${range} days`}
        value={runs.toLocaleString()}
        delta={<Delta pct={pctChange(runs, prevRuns)} />}
        range={range}
        onRange={setRange}
        legend={
          <>
            <LegendCard color={GREEN} label="Success · total" value={success.toLocaleString()} />
            <LegendCard color={RED} label="Failed · total" value={failed.toLocaleString()} />
          </>
        }
      >
        <ChartContainer config={runsConfig} className="h-52 w-full">
          <BarChart data={data} margin={{ left: -18, right: 4, top: 8 }} barCategoryGap={range === 45 ? "18%" : "28%"}>
            <CartesianGrid vertical={false} strokeDasharray="4 4" className="stroke-border" />
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={false}
              interval={tickEvery - 1}
              fontSize={11}
              tickMargin={8}
            />
            <YAxis tickLine={false} axisLine={false} allowDecimals={false} fontSize={11} width={40} />
            <ChartTooltip
              cursor={{ fill: "var(--muted)", opacity: 0.5 }}
              content={
                <Tip
                  render={(p) => (
                    <>
                      <p className="font-medium">{p.day}</p>
                      <p className="text-muted-foreground">
                        {p.successRuns} succeeded · {p.failedRuns} failed
                      </p>
                    </>
                  )}
                />
              }
            />
            <Bar dataKey="successRuns" stackId="r" fill={GREEN} radius={[0, 0, 6, 6]} />
            <Bar dataKey="failedRuns" stackId="r" fill={RED} radius={[6, 6, 0, 0]} />
          </BarChart>
        </ChartContainer>
      </Card>

      <Card
        title={`Latency · last ${range} days`}
        value={runs > 0 ? fmtSec(avgNow) : "—"}
        delta={<Delta pct={pctChange(avgNow, prevAvg)} goodWhenDown />}
        range={range}
        onRange={setRange}
        legend={
          <>
            <LegendCard color={GREEN_LINE} label="Fastest day" value={fastest !== null ? fmtSec(fastest) : "—"} />
            <LegendCard color={BLUE} label="Average" value={runs > 0 ? fmtSec(avgNow) : "—"} />
            <LegendCard color={RED} label="Slowest day" value={slowest !== null ? fmtSec(slowest) : "—"} />
          </>
        }
      >
        <ChartContainer config={latencyConfig} className="h-52 w-full">
          <ScatterChart margin={{ left: -8, right: 12, top: 8 }}>
            <CartesianGrid strokeDasharray="4 4" className="stroke-border" />
            <XAxis
              type="number"
              dataKey="x"
              domain={[-0.5, range - 0.5]}
              ticks={ticks}
              tickFormatter={(x: number) => data[x]?.label ?? ""}
              tickLine={false}
              axisLine={false}
              fontSize={11}
              tickMargin={8}
            />
            <YAxis
              type="number"
              dataKey="avgMs"
              tickFormatter={(v: number) => fmtSec(v)}
              tickLine={false}
              axisLine={false}
              fontSize={11}
              width={52}
            />
            <ZAxis type="number" dataKey="totalRuns" range={[70, 340]} />
            <ChartTooltip
              cursor={{ strokeDasharray: "3 3" }}
              content={
                <Tip
                  render={(p) => (
                    <>
                      <p className="font-medium">{p.day}</p>
                      <p className="text-muted-foreground">
                        {fmtSec(p.avgMs)} avg · {p.totalRuns} {p.totalRuns === 1 ? "run" : "runs"}
                      </p>
                    </>
                  )}
                />
              }
            />
            <Scatter data={healthy} fill={BLUE} fillOpacity={0.45} stroke={BLUE} strokeWidth={1.5} />
            <Scatter data={hadFailures} fill={RED} fillOpacity={0.45} stroke={RED} strokeWidth={1.5} />
          </ScatterChart>
        </ChartContainer>
      </Card>
    </div>
  );
}
