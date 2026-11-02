"use client";

import React, { useMemo } from "react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";

export interface DailyPoint {
  day: string;
  totalRuns: number;
  successRuns: number;
  failedRuns: number;
  totalLatencyMs: number;
}

const DAYS = 30;

const runsConfig = {
  successRuns: { label: "Success", color: "var(--chart-2)" },
  failedRuns: { label: "Failed", color: "oklch(0.63 0.22 25)" },
} satisfies ChartConfig;

const latencyConfig = {
  avgMs: { label: "Avg latency (ms)", color: "var(--chart-1)" },
} satisfies ChartConfig;

/** Last 30 days, with quiet days filled in as zero so the x-axis is continuous. */
function fill(daily: DailyPoint[]) {
  const byDay = new Map(daily.map((d) => [d.day, d]));
  const out = [];
  for (let i = DAYS - 1; i >= 0; i--) {
    const day = new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10);
    const d = byDay.get(day);
    out.push({
      day,
      label: day.slice(5),
      successRuns: d?.successRuns ?? 0,
      failedRuns: d?.failedRuns ?? 0,
      avgMs: d && d.totalRuns > 0 ? Math.round(d.totalLatencyMs / d.totalRuns) : null,
    });
  }
  return out;
}

function ChartCard({ title, caption, children }: { title: string; caption: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border p-4">
      <p className="text-xs font-medium text-foreground">{title}</p>
      <p className="text-[11px] text-muted-foreground mb-3">{caption}</p>
      {children}
    </div>
  );
}

export function AgentActivityCharts({ daily }: { daily: DailyPoint[] }) {
  const data = useMemo(() => fill(daily), [daily]);

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <ChartCard title="Runs" caption="Success vs failed, last 30 days">
        <ChartContainer config={runsConfig} className="h-44 w-full">
          <BarChart data={data} margin={{ left: -20, right: 4 }}>
            <CartesianGrid vertical={false} strokeDasharray="3 3" />
            <XAxis dataKey="label" tickLine={false} axisLine={false} interval={6} fontSize={10} />
            <YAxis tickLine={false} axisLine={false} allowDecimals={false} fontSize={10} />
            <ChartTooltip content={<ChartTooltipContent />} />
            <Bar dataKey="successRuns" stackId="r" fill="var(--color-successRuns)" radius={[0, 0, 2, 2]} />
            <Bar dataKey="failedRuns" stackId="r" fill="var(--color-failedRuns)" radius={[2, 2, 0, 0]} />
          </BarChart>
        </ChartContainer>
      </ChartCard>

      <ChartCard title="Average latency" caption="Milliseconds per call, last 30 days">
        <ChartContainer config={latencyConfig} className="h-44 w-full">
          <LineChart data={data} margin={{ left: -12, right: 8 }}>
            <CartesianGrid vertical={false} strokeDasharray="3 3" />
            <XAxis dataKey="label" tickLine={false} axisLine={false} interval={6} fontSize={10} />
            <YAxis tickLine={false} axisLine={false} fontSize={10} />
            <ChartTooltip content={<ChartTooltipContent />} />
            <Line
              dataKey="avgMs"
              type="monotone"
              stroke="var(--color-avgMs)"
              strokeWidth={2}
              dot={false}
              connectNulls
            />
          </LineChart>
        </ChartContainer>
      </ChartCard>
    </div>
  );
}
