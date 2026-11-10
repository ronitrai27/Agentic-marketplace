"use client";

import React from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { fmtDate } from "@/lib/agent-display";
import { compareVersions } from "@/lib/agent-version";

interface VersionRow {
  version: string;
  createdAt: number;
}

function VersionList({ versions, current }: { versions: VersionRow[]; current: string }) {
  return (
    <div className="space-y-1.5">
      <p className="px-1 text-[11px] font-medium text-muted-foreground">Recent versions</p>
      <ul className="space-y-0.5">
        {versions.map((v) => (
          <li key={v.version} className="flex items-center justify-between gap-3 rounded-md px-1 py-1 text-xs">
            <span className="flex items-center gap-1.5 font-mono text-foreground">
              v{v.version}
              {v.version === current && (
                <span className="rounded-full bg-emerald-500/10 px-1.5 py-px font-sans text-[10px] font-medium text-emerald-600">
                  Current
                </span>
              )}
            </span>
            <span className="text-muted-foreground">{fmtDate(v.createdAt)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** A trigger that opens the version list on hover or keyboard focus, and on tap for touch screens. */
function HoverList({
  children,
  label,
  versions,
  current,
}: {
  children: React.ReactNode;
  label: string;
  versions: VersionRow[];
  current: string;
}) {
  return (
    <Popover>
      <PopoverTrigger
        openOnHover
        delay={100}
        aria-label={label}
        className="inline-flex cursor-pointer items-center gap-1 rounded-sm outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-foreground/30"
      >
        {children}
      </PopoverTrigger>
      <PopoverContent side="bottom" align="start" className="w-64">
        <VersionList versions={versions} current={current} />
      </PopoverContent>
    </Popover>
  );
}

/**
 * Header line fragment: "v2.1.0 · Listed <date> · Updated <date>".
 * The chevrons and the "Updated" date appear only once the agent has more than one version.
 */
export function AgentVersionInfo({
  version,
  listedAt,
  updatedAt,
  versions,
}: {
  version: string;
  listedAt: number;
  updatedAt: number;
  versions: VersionRow[];
}) {
  const changed = versions.length > 1;
  // Up when the newest version is higher than the one before it, down for a rollback
  const rolledBack = changed && compareVersions(versions[0].version, versions[1].version) < 0;
  const Arrow = rolledBack ? ChevronDown : ChevronUp;
  const arrowColor = rolledBack ? "text-amber-600" : "text-emerald-600";

  return (
    <>
      {changed ? (
        <HoverList label="Version history" versions={versions} current={version}>
          <span>v{version}</span>
          <Arrow className={`size-3.5 ${arrowColor}`} aria-hidden />
        </HoverList>
      ) : (
        <span>v{version}</span>
      )}
      <span>·</span>
      <span>Listed {fmtDate(listedAt)}</span>
      {changed && (
        <>
          <span>·</span>
          <HoverList label="Version history" versions={versions} current={version}>
            <span>Updated {fmtDate(updatedAt)}</span>
            <Arrow className={`size-3.5 ${arrowColor}`} aria-hidden />
          </HoverList>
        </>
      )}
    </>
  );
}
