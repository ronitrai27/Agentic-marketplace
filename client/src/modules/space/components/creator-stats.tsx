"use client";

import React from "react";
import { Brain, Star, Trophy, Workflow } from "lucide-react";
import { demoRatingFor, normaliseRating } from "./agent-rating";
import type { AgentWithPricing } from "./agent-card";

// DEMO DATA: replace with real run aggregates once those tables exist.
const DEMO = {
  totalRuns: 12480,
  successfulRuns: 12107,
};

function Box({
  icon: Icon,
  label,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border bg-linear-to-br from-white to-neutral-100 dark:from-card dark:to-neutral-900 p-4 min-h-32 flex flex-col">
      <div className="flex items-center gap-2 text-muted-foreground">
        <Icon className="size-3.5" />
        <p className="text-xs">{label}</p>
      </div>
      <div className="flex-1 flex items-end mt-3">{children}</div>
    </div>
  );
}

/** Two figures side by side with a straight line between them. */
function Pair({ left, right }: { left: [string, React.ReactNode]; right: [string, React.ReactNode] }) {
  return (
    <div className="flex items-stretch gap-5 w-full">
      {[left, right].map(([label, value], i) => (
        <React.Fragment key={label}>
          {i === 1 && <div className="w-px bg-border" />}
          <div className="flex-1">
            <p className="text-3xl font-semibold tracking-tight text-foreground tabular-nums leading-none">{value}</p>
            <p className="text-xs text-muted-foreground mt-1.5">{label}</p>
          </div>
        </React.Fragment>
      ))}
    </div>
  );
}

export function CreatorStats({ agents }: { agents: AgentWithPricing[] }) {
  const active = agents.filter((a) => a.status === "active").length;

  const top = agents
    .filter((a) => a.status !== "archived")
    .map((a) => ({ agent: a, rating: normaliseRating(demoRatingFor(a._id)) }))
    .sort((a, b) => b.rating - a.rating || a.agent.name.localeCompare(b.agent.name))
    .slice(0, 3);

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      <Box icon={Brain} label="Agents">
        <Pair left={["Total", agents.length]} right={["Active", active]} />
      </Box>

      <Box icon={Workflow} label="Runs">
        <Pair
          left={["Total runs", DEMO.totalRuns.toLocaleString()]}
          right={["Successful", DEMO.successfulRuns.toLocaleString()]}
        />
      </Box>

      <Box icon={Trophy} label="Top agents by rating">
        {top.length === 0 ? (
          <p className="text-xs text-muted-foreground">No rated agents yet.</p>
        ) : (
          <ol className="w-full space-y-2.5">
            {top.map(({ agent, rating }, i) => (
              <li key={agent._id} className="flex items-center gap-3 text-sm">
                <span className="w-4 text-xs text-muted-foreground tabular-nums">{i + 1}</span>
                <span className="flex-1 min-w-0 truncate font-medium text-foreground">{agent.name}</span>
                <span className="inline-flex items-center gap-1 text-foreground tabular-nums">
                  <Star className="size-3.5 fill-amber-400 text-amber-400" strokeWidth={1.5} />
                  {rating.toFixed(1)}
                </span>
              </li>
            ))}
          </ol>
        )}
      </Box>
    </div>
  );
}
