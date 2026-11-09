"use client";

import React from "react";
import Link from "next/link";
import { useQuery } from "convex/react";
import { motion } from "framer-motion";
import { Skeleton } from "@/components/ui/skeleton";
import { Star, Sparkles, Plus, FolderDownIcon, Brain } from "lucide-react";
import { api } from "../../../../convex/_generated/api";
import { tagById } from "@/lib/agent-tags";
import { uniqueModelIcons } from "@/lib/agent-display";
import { AgentLogo } from "./agent-logo";
import { ModelLogos } from "./agent-card";

type CardAgent = {
  key: string;
  slug?: string;
  name: string;
  logoUrl?: string;
  tags: string[];
  models: { id: string; provider?: string }[];
  rating: number;
  demo?: boolean;
};

const DEMO_AGENTS: CardAgent[] = [
  {
    key: "demo-1",
    name: "Inbox Pilot",
    tags: ["Cold email", "Outreach"],
    models: [{ id: "claude-sonnet-5-5", provider: "anthropic" }],
    rating: 0,
    demo: true,
  },
  {
    key: "demo-2",
    name: "Invoice Scout",
    tags: ["Invoice", "Finance"],
    models: [{ id: "gpt-4.1", provider: "openai" }],
    rating: 0,
    demo: true,
  },
  {
    key: "demo-3",
    name: "Plagiarism Lens",
    tags: ["Plagiarism", "Research"],
    models: [{ id: "gemini-2.5-pro", provider: "google" }],
    rating: 0,
    demo: true,
  },
];

export function TryAgents() {
  const featured = useQuery(api.agents.listFeatured);
  const loading = featured === undefined;

  const real: CardAgent[] = (featured ?? []).map((a) => ({
    key: a._id,
    slug: a.slug,
    name: a.name,
    logoUrl: a.logoUrl,
    tags: a.tags,
    models: a.models,
    rating: a.ratingAvg,
  }));
  const cards = [...real, ...DEMO_AGENTS.slice(0, 3 - real.length)];

  return (
    <div className="w-full mb-5 2xl:mb-7">
      <div className="flex items-center justify-between mb-2 2xl:mb-2.5 px-1">
        <span className="text-xs font-semibold uppercase tracking-wider flex items-center gap-1.5">
          <Brain className="size-3 2xl:size-3.5 text-muted-foreground" />
          Try these Agents
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 2xl:gap-3">
        {loading &&
          [0, 1, 2].map((i) => (
            <div
              key={i}
              className="p-2.5 2xl:p-3.5 rounded-lg border border-neutral-300 dark:border-neutral-800/80 bg-neutral-100 dark:bg-neutral-950/40 flex flex-col justify-between gap-2.5"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Skeleton className="size-7 rounded-md" />
                  <Skeleton className="h-3.5 w-24" />
                </div>
                <Skeleton className="h-3.5 w-8" />
              </div>
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  <Skeleton className="h-4 w-14 rounded-full" />
                  <Skeleton className="h-4 w-16 rounded-full" />
                </div>
                <Skeleton className="size-5 rounded-full" />
              </div>
            </div>
          ))}
        {!loading &&
          cards.map((agent, idx) => {
            const modelIcons = uniqueModelIcons(agent.models);
            // If more model logos are present (>1), show only 1 tag to keep space for model logos
            const maxTags = modelIcons.length > 1 ? 1 : 2;
            const visibleTags = agent.tags.slice(0, maxTags);
            const remainingTags = agent.tags.length - visibleTags.length;

            const cardClass =
              "p-2.5 2xl:p-3.5 rounded-lg border border-neutral-300 dark:border-neutral-800/80 bg-neutral-50 dark:bg-neutral-950/40 flex flex-col justify-between gap-2.5";
            const inner = (
              <>
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <AgentLogo
                      name={agent.name}
                      logoUrl={agent.logoUrl}
                      className="size-7 text-xs shrink-0"
                    />
                    <span className="text-xs 2xl:text-sm font-medium text-foreground tracking-tight truncate">
                      {agent.name}
                    </span>
                  </div>
                  <span className="flex items-center gap-1 text-xs text-foreground tabular-nums shrink-0">
                    <Star
                      className="size-3.5 fill-amber-400 text-amber-400"
                      strokeWidth={1.5}
                    />
                    {agent.rating.toFixed(1)}
                  </span>
                </div>

                <div className="flex items-center justify-between gap-2 min-w-0">
                  <div className="flex items-center gap-1.5 min-w-0 overflow-hidden">
                    {visibleTags.map((id) => (
                      <span
                        key={id}
                        className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-foreground truncate max-w-[120px] shrink-0"
                      >
                        {tagById(id)?.label ?? id}
                      </span>
                    ))}
                    {remainingTags > 0 && (
                      <span
                        className="inline-flex items-center gap-0.5 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground shrink-0"
                        title={agent.tags
                          .slice(maxTags)
                          .map((id) => tagById(id)?.label ?? id)
                          .join(", ")}
                      >
                        <Plus className="size-2.5" />
                        {remainingTags}
                      </span>
                    )}
                  </div>

                  <div className="shrink-0 flex items-center gap-1.5 ml-auto">
                    <ModelLogos models={agent.models} />
                  </div>
                </div>
              </>
            );

            const enter = {
              initial: { opacity: 0, y: 8 },
              animate: { opacity: 1, y: 0 },
              transition: {
                duration: 0.35,
                ease: "easeOut" as const,
                delay: idx * 0.07,
              },
            };

            return agent.slug ? (
              <motion.div key={agent.key} {...enter} className="flex flex-col">
                <Link
                  href={`/space/marketplace/${agent.slug}`}
                  className={`${cardClass} flex-1 hover:border-foreground/30 hover:bg-neutral-50 dark:hover:bg-neutral-950/70 transition-colors cursor-pointer`}
                >
                  {inner}
                </Link>
              </motion.div>
            ) : (
              <motion.div key={agent.key} {...enter} className={cardClass}>
                {inner}
              </motion.div>
            );
          })}
      </div>
    </div>
  );
}
