"use client";

import { ArrowRight } from "lucide-react";

interface Recipe {
  id: string;
  title: string;
  prompt: string;
  tags: string[];
  Art: React.ElementType;
}

/* Shared tokens for the animated illustrations (all neutral + one orange accent) */
const ACCENT = "#f97316";
const ACCENT_SOFT = "#fed7aa";

function ResearchArt() {
  return (
    <svg viewBox="0 0 240 120" className="w-full h-full" aria-hidden>
      {/* result rows */}
      {[22, 52, 82].map((y, i) => (
        <g
          key={y}
          className="recipe-row"
          style={{ animationDelay: `${i * 0.5}s` }}
        >
          <rect
            x="40"
            y={y}
            width="160"
            height="22"
            rx="11"
            className="fill-white dark:fill-neutral-900 stroke-neutral-200 dark:stroke-neutral-700"
          />
          <circle cx="54" cy={y + 11} r="5" fill={ACCENT_SOFT} />
          <rect
            x="66"
            y={y + 8}
            width={70 + i * 14}
            height="6"
            rx="3"
            fill={ACCENT_SOFT}
          />
          <rect
            x="158"
            y={y + 8}
            width="30"
            height="6"
            rx="3"
            className="fill-neutral-200 dark:fill-neutral-700"
          />
        </g>
      ))}
      {/* magnifier scanning down the list */}
      <g className="recipe-scan">
        <circle
          cx="206"
          cy="32"
          r="11"
          fill="none"
          stroke={ACCENT}
          strokeWidth="3"
        />
        <line
          x1="214"
          y1="40"
          x2="222"
          y2="48"
          stroke={ACCENT}
          strokeWidth="3"
          strokeLinecap="round"
        />
      </g>
    </svg>
  );
}

function LeadsArt() {
  return (
    <svg viewBox="0 0 240 120" className="w-full h-full" aria-hidden>
      {[14, 44, 74].map((y, i) => (
        <g
          key={y}
          className="recipe-lead"
          style={{ animationDelay: `${i * 0.9}s` }}
        >
          <rect
            x="30"
            y={y}
            width="180"
            height="26"
            rx="13"
            className="fill-white dark:fill-neutral-900 stroke-neutral-200 dark:stroke-neutral-700"
          />
          <circle cx="46" cy={y + 13} r="7" fill={ACCENT_SOFT} />
          <rect
            x="60"
            y={y + 7}
            width="64"
            height="5"
            rx="2.5"
            fill={ACCENT_SOFT}
          />
          <rect
            x="60"
            y={y + 15}
            width="40"
            height="4"
            rx="2"
            className="fill-neutral-200 dark:fill-neutral-700"
          />
          <rect
            x="140"
            y={y + 10}
            width="32"
            height="6"
            rx="3"
            className="fill-neutral-200 dark:fill-neutral-700"
          />
          <g
            className="recipe-plus"
            style={{ animationDelay: `${i * 0.9 + 0.3}s` }}
          >
            <circle cx="192" cy={y + 13} r="8" fill={ACCENT} />
            <path
              d={`M188 ${y + 13}h8M192 ${y + 9}v8`}
              stroke="white"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
          </g>
        </g>
      ))}
    </svg>
  );
}

function SeoArt() {
  return (
    <svg viewBox="0 0 240 120" className="w-full h-full" aria-hidden>
      {/* grid */}
      {[30, 55, 80].map((y) => (
        <line
          key={y}
          x1="30"
          x2="210"
          y1={y}
          y2={y}
          strokeDasharray="3 4"
          className="stroke-neutral-200 dark:stroke-neutral-700"
        />
      ))}
      {/* bars */}
      {[0, 1, 2, 3, 4].map((i) => (
        <rect
          key={i}
          x={42 + i * 34}
          y={100 - (18 + i * 10)}
          width="16"
          height={18 + i * 10}
          rx="3"
          fill={ACCENT_SOFT}
          className="recipe-bar"
          style={{ animationDelay: `${i * 0.15}s` }}
        />
      ))}
      {/* trend line drawing itself */}
      <path
        d="M50 78 L84 66 L118 70 L152 48 L186 30"
        fill="none"
        stroke={ACCENT}
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
        pathLength={1}
        className="recipe-line"
      />
      <circle cx="186" cy="30" r="5" fill={ACCENT} className="recipe-dot" />
    </svg>
  );
}

export const RECIPES: Recipe[] = [
  {
    id: "research",
    title: "Research",
    prompt:
      "Research the Indian AI SaaS market, identify the top 10 competitors, compare their pricing and features, and deliver a report on market opportunities.",
    tags: ["Web research", "Market intelligence", "Competitor analysis"],
    Art: ResearchArt,
  },
  {
    id: "lead-generation",
    title: "Lead Generation",
    prompt:
      "Find 100 qualified leads for my AI automation agency targeting US-based SaaS startups, including company names, decision-makers, LinkedIn profiles, and business emails.",
    tags: ["Prospecting", "ICP targeting", "Lead enrichment", "B2B sales"],
    Art: LeadsArt,
  },
  {
    id: "seo-geo",
    title: "SEO & GEO Optimization",
    prompt:
      "Audit my website for SEO, identify technical issues and keyword gaps, analyze AI search visibility, and generate an actionable SEO + GEO optimization plan.",
    tags: [
      "Technical SEO",
      "GEO (Generative Engine Optimization)",
      "Keyword research",
      "AI visibility",
    ],
    Art: SeoArt,
  },
];

export function RecipeCards({
  onSelect,
}: {
  onSelect: (prompt: string) => void;
}) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3 2xl:gap-4">
      {RECIPES.map(({ id, title, prompt, tags, Art }) => (
        <button
          key={id}
          type="button"
          onClick={() => onSelect(prompt)}
          className="group text-left rounded-xl border border-border/70 dark:border-neutral-800 bg-neutral-100/40 dark:bg-neutral-900/40 p-1.5 transition-all duration-200 hover:border-border hover:shadow-xs hover:-translate-y-0.5 active:translate-y-0 flex flex-col"
        >
          <div className="h-28 2xl:h-32 rounded-lg border border-border dark:border-neutral-800 bg-white dark:bg-neutral-950/60 overflow-hidden">
            <Art />
          </div>

          <div className="px-2.5 pt-3 pb-2 flex flex-col flex-1">
            <h3 className="text-xs 2xl:text-sm font-medium text-foreground tracking-tight">
              {title}
            </h3>
            <p className="mt-1 text-[11px] 2xl:text-xs text-muted-foreground leading-relaxed line-clamp-3">
              “{prompt}”
            </p>
            <div className="mt-2.5 flex flex-wrap gap-1">
              {tags.map((tag) => (
                <span
                  key={tag}
                  className="text-[9px] 2xl:text-[10px] px-1.5 py-0.5 rounded font-medium bg-neutral-200/60 dark:bg-neutral-800/80 text-muted-foreground border border-border/40"
                >
                  {tag}
                </span>
              ))}
            </div>
            <div className="mt-3 inline-flex items-center gap-1 text-[11px] text-muted-foreground group-hover:text-foreground transition-colors">
              Use recipe
              <ArrowRight className="size-3 transition-transform group-hover:translate-x-0.5" />
            </div>
          </div>
        </button>
      ))}
    </div>
  );
}
