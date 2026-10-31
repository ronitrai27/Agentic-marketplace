"use client";

import React from "react";
import { Brain } from "lucide-react";
import { Button } from "@/components/ui/button";
import { tagById } from "@/lib/agent-tags";
import {
  priceSummary,
  uniqueModelIcons,
  type PlanMicros,
} from "@/lib/agent-display";
import { AgentLogo } from "./agent-logo";
import { AgentRating, demoRatingFor } from "./agent-rating";
import type { Doc } from "../../../../convex/_generated/dataModel";

export type AgentWithPricing = Doc<"agents"> & {
  pricing: Doc<"agent_pricing"> | null;
};

const STATUS: Record<Doc<"agents">["status"], { label: string; dot: string }> =
  {
    active: { label: "Active", dot: "bg-green-500" },
    paused: { label: "Paused", dot: "bg-amber-500" },
    suspended: { label: "Suspended", dot: "bg-red-500" },
    archived: { label: "Archived", dot: "bg-zinc-400" },
  };

export function StatusText({ status }: { status: Doc<"agents">["status"] }) {
  const s = STATUS[status];
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
      <span className={`size-1.5 rounded-full ${s.dot}`} />
      {s.label}
    </span>
  );
}

/** Every distinct model logo the agent used, in a row. */
export function ModelLogos({ models }: { models: Doc<"agents">["models"] }) {
  const icons = uniqueModelIcons(models);
  if (models.length === 0)
    return (
      <span className="text-[11px] text-muted-foreground">
        No models reported
      </span>
    );
  if (icons.length === 0)
    return <Brain className="size-4 text-muted-foreground" />;
  return (
    <div className="flex items-center gap-2.5">
      {icons.map((icon) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={icon.src}
          src={icon.src}
          alt={icon.name}
          title={icon.name}
          className={`size-6 ${icon.theme ?? ""}`}
        />
      ))}
    </div>
  );
}

export function AgentCard({
  agent,
  onOpen,
  onDelete,
}: {
  agent: AgentWithPricing;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const tags = agent.tags.slice(0, 3);
  const extra = agent.tags.length - tags.length;

  return (
    <div
      className={`rounded-xl border border-border bg-card p-5 shadow-2xs transition-colors hover:border-foreground/30 flex flex-col gap-4 ${agent.status === "archived" ? "opacity-60" : ""}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <AgentLogo name={agent.name} logoUrl={agent.logoUrl} />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground truncate">
              {agent.name}
            </p>
            <StatusText status={agent.status} />
          </div>
        </div>
        <AgentRating value={demoRatingFor(agent._id)} className="shrink-0" />
      </div>

      <p className="text-xs text-muted-foreground leading-relaxed truncate min-h-4">
        {agent.description || "No description provided."}
      </p>

      <div className="flex flex-wrap gap-1.5">
        {tags.map((id) => (
          <span
            key={id}
            className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-foreground"
          >
            {tagById(id)?.label ?? id}
          </span>
        ))}
        {extra > 0 && (
          <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
            +{extra}
          </span>
        )}
      </div>

      <div className="flex items-center justify-between gap-3 pt-4 mt-auto border-t border-border">
        <ModelLogos models={agent.models} />
        <div className="text-right">
          <p className="text-xs font-semibold text-foreground">
            {priceSummary(agent.pricing?.plan as PlanMicros | undefined)}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Button
          type="button"
          size="sm"
          onClick={onOpen}
          className="cursor-pointer"
        >
          View
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={agent.status === "archived"}
          onClick={onDelete}
          className="cursor-pointer text-destructive hover:text-destructive"
        >
          Delete
        </Button>
      </div>
    </div>
  );
}
