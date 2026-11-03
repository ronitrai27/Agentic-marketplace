"use client";

import React from "react";
import { ChefHat, LayoutGrid, Play } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Same shape as the lucide "activity" icon, drawn as a path so the line can trace like a heartbeat. */
function HeartbeatIcon() {
  const d = "M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.48 12H2";
  return (
    <svg
      viewBox="0 0 24 24"
      className="heartbeat-icon size-4 overflow-visible"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d={d} opacity={0.35} />
      <path d={d} pathLength={1} className="heartbeat-line" />
    </svg>
  );
}

/** UI only for now: Run Agent plus two extra options that slide in below it on hover or keyboard focus. */
export function RunAgentButton() {
  return (
    <div className="group relative">
      <Button size="lg" className="gap-2">
        Run Agent
        <HeartbeatIcon />
      </Button>

      <div className="pointer-events-none absolute right-0 top-full z-20 w-max translate-y-1 pt-2 opacity-0 transition duration-150 group-hover:pointer-events-auto group-hover:translate-y-0 group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:translate-y-0 group-focus-within:opacity-100">
        <div className="flex w-full flex-col gap-1.5 rounded-xl border border-border bg-background p-1.5 shadow-lg">
          <Button variant="ghost" size="sm" className="justify-start gap-2">
            <Play className="size-4" />
            Run Now
          </Button>
          <Button variant="ghost" size="sm" className="justify-start gap-2">
            <ChefHat className="size-4" />
            Ask chef to run
          </Button>
          <Button variant="ghost" size="sm" className="justify-start gap-2">
            <LayoutGrid className="size-4" />
            View More Agents
          </Button>
        </div>
      </div>
    </div>
  );
}
