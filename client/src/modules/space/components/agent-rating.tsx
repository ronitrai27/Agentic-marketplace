"use client";

import React from "react";
import { Star } from "lucide-react";

/** One-line verdict for each step of the scale. */
const RATING_LABELS: Array<[number, string]> = [
  [1, "Poor"],
  [2, "Unreliable"],
  [2.5, "Unreliable"],
  [3, "Good"],
  [3.5, "Competent"],
  [4, "Reliable"],
  [4.5, "Excellent"],
  [5, "Exceptional"],
];

/** Rounds to the nearest half star and clamps to 1..5. */
export function normaliseRating(value: number): number {
  const r = Math.round(value * 2) / 2;
  return Math.min(5, Math.max(1, r));
}

export function ratingLabel(value: number): string {
  const r = normaliseRating(value);
  return [...RATING_LABELS].reverse().find(([min]) => r >= min)?.[1] ?? "Poor";
}

/** DEMO: a stable fake rating per agent until real reviews exist. */
export function demoRatingFor(id: string): number {
  const steps = RATING_LABELS.map(([n]) => n).filter((n) => n >= 3.5);
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return steps[h % steps.length];
}

/** A single star, filled in proportion to the rating, with the score and a one-word verdict. */
export function AgentRating({
  value,
  align = "right",
  className = "",
}: {
  value: number;
  align?: "left" | "right";
  className?: string;
}) {
  const r = normaliseRating(value);
  const fill = (r / 5) * 100;

  return (
    <div className={`flex flex-col ${align === "right" ? "items-end" : "items-start"} ${className}`}>
      <div className="flex items-center gap-1.5">
        <span className="relative size-4 shrink-0" aria-hidden>
          <Star className="absolute inset-0 size-4 text-muted-foreground/40" strokeWidth={1.5} />
          <span className="absolute inset-0 overflow-hidden" style={{ width: `${fill}%` }}>
            <Star className="size-4 fill-amber-400 text-amber-400" strokeWidth={1.5} />
          </span>
        </span>
        <span className="text-sm font-semibold text-foreground tabular-nums">{r.toFixed(1)}</span>
      </div>
      <span className="text-[11px] text-muted-foreground leading-tight mt-0.5">{ratingLabel(r)}</span>
    </div>
  );
}
