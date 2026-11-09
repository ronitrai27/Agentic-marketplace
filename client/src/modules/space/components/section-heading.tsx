import React from "react";
import type { LucideIcon } from "lucide-react";

/** Heading for a section of the register flow: dark icon tile, title, one-line hint, optional right-side slot. */
export function SectionHeading({
  icon: Icon,
  title,
  children,
  right,
}: {
  icon: LucideIcon;
  title: string;
  children?: React.ReactNode;
  right?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex items-start gap-3">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-foreground text-background shadow-sm">
          <Icon className="size-4" />
        </span>
        <div className="min-w-0">
          <h3 className="text-base font-semibold leading-8 text-foreground">
            {title}
          </h3>
          {children && (
            <p className="text-sm text-zinc-700 dark:text-zinc-300 leading-relaxed">
              {children}
            </p>
          )}
        </div>
      </div>
      {right && <div className="shrink-0 pt-1">{right}</div>}
    </div>
  );
}

/** Filled background for inputs on the register flow, so fields stand apart from the dialog surface. */
export const FIELD_FILL =
  "bg-muted/60 border-border/80 shadow-none transition-colors hover:bg-muted focus-visible:bg-background dark:bg-muted/40";
