"use client";

import React from "react";
import { Check, FileText, Lightbulb } from "lucide-react";
import { SectionHeading } from "./section-heading";
import { Textarea } from "@/components/ui/textarea";
import {
  MAX_DESCRIPTION_CHARS,
  MAX_DESCRIPTION_WORDS,
  MIN_DESCRIPTION_WORDS,
  wordCount,
} from "@/lib/agent-description";

/** Description box for the Publish step: a live word count between 20 and 100, with a meter that shows where you are. */
export function DescriptionField({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const words = wordCount(value);
  const tooShort = words < MIN_DESCRIPTION_WORDS;
  const tooLong = words > MAX_DESCRIPTION_WORDS;
  const ok = !tooShort && !tooLong;
  const pct = Math.min(100, (words / MAX_DESCRIPTION_WORDS) * 100);
  const minPct = (MIN_DESCRIPTION_WORDS / MAX_DESCRIPTION_WORDS) * 100;

  const toGo = MIN_DESCRIPTION_WORDS - words;
  const over = words - MAX_DESCRIPTION_WORDS;
  const status =
    words === 0
      ? `${MIN_DESCRIPTION_WORDS} to ${MAX_DESCRIPTION_WORDS} words`
      : tooShort
        ? `${toGo} more word${toGo === 1 ? "" : "s"} to go`
        : tooLong
          ? `${over} word${over === 1 ? "" : "s"} over`
          : "Looks good";

  const tone = ok
    ? "text-emerald-600"
    : tooLong
      ? "text-destructive"
      : "text-muted-foreground";
  const bar = ok
    ? "bg-emerald-500"
    : tooLong
      ? "bg-destructive"
      : "bg-foreground/40";

  return (
    <section className="space-y-4 border-b border-border pb-8">
      <SectionHeading icon={FileText} title="What does your agent do?">
        Buyers read this, and the marketplace uses it to match tasks to your
        agent. A clear description means more matches and more revenue.
      </SectionHeading>

      <div className="rounded-xl border border-border/80 bg-muted/60 transition-colors hover:bg-muted focus-within:border-foreground/40 focus-within:bg-background dark:bg-muted/40">
        <Textarea
          rows={5}
          value={value}
          maxLength={MAX_DESCRIPTION_CHARS}
          onChange={(e) => onChange(e.target.value)}
          placeholder="What does your agent do?"
          aria-describedby="description-help"
          className="resize-none border-0 bg-transparent px-3.5 pt-3 text-sm leading-relaxed shadow-none focus-visible:ring-0"
        />

        <div className="px-3.5 pb-3 pt-1">
          <div className="relative h-1.5 overflow-hidden rounded-full bg-foreground/10">
            <div
              className={`h-full rounded-full transition-all duration-200 ${bar}`}
              style={{ width: `${pct}%` }}
            />
            {/* where "long enough" starts */}
            <span
              className="absolute inset-y-0 w-px bg-foreground/30"
              style={{ left: `${minPct}%` }}
              aria-hidden
            />
          </div>
          <div
            id="description-help"
            className="mt-2 flex items-center justify-between text-xs"
          >
            <span
              className={`inline-flex items-center gap-1 font-medium ${tone}`}
            >
              {ok && <Check className="size-3.5" />}
              {status}
            </span>
            <span className="tabular-nums text-muted-foreground">
              {words} / {MAX_DESCRIPTION_WORDS} words
            </span>
          </div>
        </div>
      </div>

      <p className="flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
        <Lightbulb className="mt-px size-3.5 shrink-0" />
        <span>
          Cover three things:{" "}
          <span className="text-foreground">what it does</span>,{" "}
          <span className="text-foreground">who it is for</span> and{" "}
          <span className="text-foreground">what the buyer gets back</span>.
        </span>
      </p>
    </section>
  );
}
