"use client";

import { useState, useRef, useEffect } from "react";
import { Mascot } from "page-mascot";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Sparkles,
  ArrowUp,
  Bot,
  Search,
  Code2,
  FileText,
  BarChart3,
  ShieldCheck,
  TrendingUp,
  Cpu,
  Layers,
  Zap,
} from "lucide-react";

interface AgentItem {
  id: string;
  name: string;
  role: string;
  icon: React.ElementType;
  badge?: string;
}

const AGENTS: AgentItem[] = [
  {
    id: "lead",
    name: "Lead Orchestrator",
    role: "Coordinates task execution & plan breakdown",
    icon: Bot,
    badge: "Primary",
  },
  {
    id: "research",
    name: "Deep Research",
    role: "Web synthesis & verified academic citations",
    icon: Search,
    badge: "Web Active",
  },
  {
    id: "code",
    name: "Code Architect",
    role: "Full-stack code generation & review",
    icon: Code2,
    badge: "v2.4",
  },
  {
    id: "writer",
    name: "Technical Writer",
    role: "PRDs, system architecture & API specifications",
    icon: FileText,
  },
  {
    id: "analytics",
    name: "Data Analyst",
    role: "Metrics modeling & forecasting",
    icon: BarChart3,
  },
  {
    id: "security",
    name: "Security Sentinel",
    role: "Vulnerability analysis & compliance auditing",
    icon: ShieldCheck,
    badge: "Shielded",
  },
];

interface Recipe {
  id: string;
  title: string;
  prompt: string;
  tag: string;
  icon: React.ElementType;
  gradient: string;
  borderHover: string;
  glowColor: string;
}

const RECIPES: Recipe[] = [
  {
    id: "ai-trends",
    title: "AI Trends & Citations",
    prompt:
      "Conduct a comprehensive research analysis on the latest generative AI breakthroughs with verified citations and benchmarks.",
    tag: "Deep Research",
    icon: TrendingUp,
    gradient:
      "from-violet-500/10 via-purple-500/5 to-transparent hover:from-violet-500/15 hover:via-purple-500/10",
    borderHover: "hover:border-violet-500/40 dark:hover:border-violet-400/40",
    glowColor: "group-hover:text-violet-500 dark:group-hover:text-violet-400",
  },
  {
    id: "system-design",
    title: "Event Microservices",
    prompt:
      "Draft an end-to-end event-driven architecture with Kafka, Redis caching layers, and database sharding strategy.",
    tag: "Architecture",
    icon: Cpu,
    gradient:
      "from-cyan-500/10 via-blue-500/5 to-transparent hover:from-cyan-500/15 hover:via-blue-500/10",
    borderHover: "hover:border-cyan-500/40 dark:hover:border-cyan-400/40",
    glowColor: "group-hover:text-cyan-500 dark:group-hover:text-cyan-400",
  },
  {
    id: "landing-page",
    title: "SaaS Launch Blueprint",
    prompt:
      "Build a modern launch strategy including product positioning, telemetry tracking setup, and onboarding conversion funnels.",
    tag: "Strategy",
    icon: Layers,
    gradient:
      "from-amber-500/10 via-orange-500/5 to-transparent hover:from-amber-500/15 hover:via-orange-500/10",
    borderHover: "hover:border-amber-500/40 dark:hover:border-amber-400/40",
    glowColor: "group-hover:text-amber-500 dark:group-hover:text-amber-400",
  },
  {
    id: "audit-perf",
    title: "Perf & Security Audit",
    prompt:
      "Run an automated security vulnerability scan, identify potential memory leaks, and propose zero-downtime fixes.",
    tag: "Security",
    icon: Zap,
    gradient:
      "from-emerald-500/10 via-teal-500/5 to-transparent hover:from-emerald-500/15 hover:via-teal-500/10",
    borderHover: "hover:border-emerald-500/40 dark:hover:border-emerald-400/40",
    glowColor: "group-hover:text-emerald-500 dark:group-hover:text-emerald-400",
  },
];

const PLACEHOLDER_STRINGS = [
  "Ask for Leads generation agent.",
  "Ask for Outreach agent.",
  "Find Jobs relevant to your Resume.",
  "Give any Topic to research deep , and compare different agents.",
];

export function SpaceChefMascot() {
  const [tooltipOpen, setTooltipOpen] = useState(false);
  const hideTimerRef = useRef<NodeJS.Timeout | null>(null);

  const [promptInput, setPromptInput] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // Smooth, slow typewriter effect for placeholder
  const [placeholderText, setPlaceholderText] = useState("");
  const [stringIndex, setStringIndex] = useState(0);
  const [charIndex, setCharIndex] = useState(0);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    const currentStr = PLACEHOLDER_STRINGS[stringIndex];

    const typeSpeed = isDeleting ? 40 : 100; // Slow, deliberate typing speed

    const timer = setTimeout(() => {
      if (!isDeleting) {
        if (charIndex < currentStr.length) {
          setPlaceholderText(currentStr.slice(0, charIndex + 1));
          setCharIndex((prev) => prev + 1);
        } else {
          // Pause at complete string before deleting
          setTimeout(() => setIsDeleting(true), 2400);
        }
      } else {
        if (charIndex > 0) {
          setPlaceholderText(currentStr.slice(0, charIndex - 1));
          setCharIndex((prev) => prev - 1);
        } else {
          setIsDeleting(false);
          setStringIndex((prev) => (prev + 1) % PLACEHOLDER_STRINGS.length);
        }
      }
    }, typeSpeed);

    return () => clearTimeout(timer);
  }, [charIndex, isDeleting, stringIndex]);

  const handleMascotClick = () => {
    setTooltipOpen(true);
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
    }
    hideTimerRef.current = setTimeout(() => {
      setTooltipOpen(false);
    }, 3200);
  };

  useEffect(() => {
    return () => {
      if (hideTimerRef.current) {
        clearTimeout(hideTimerRef.current);
      }
    };
  }, []);

  const handleSelectRecipe = (recipePrompt: string) => {
    setPromptInput(recipePrompt);
    if (inputRef.current) {
      inputRef.current.focus();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      // Handle submit action
    }
  };

  return (
    <div className="w-full h-full flex flex-col overflow-y-auto px-4 py-4 md:py-6 2xl:py-10 select-none scrollbar-thin">
      <div className="max-w-4xl 2xl:max-w-5xl w-full mx-auto my-auto flex flex-col items-center">
        {/* Mascot & Heading */}
        <div className="relative flex flex-col items-center mb-3 2xl:mb-5">
          <TooltipProvider>
            <Tooltip open={tooltipOpen} onOpenChange={setTooltipOpen}>
              <TooltipTrigger
                render={<div />}
                onClick={handleMascotClick}
                className="inline-block cursor-pointer outline-none focus:outline-none bg-transparent border-0 p-0 transition-transform active:scale-95"
              >
                <div className="2xl:hidden">
                  <Mascot
                    directions="/mascots/chef-directions.webp"
                    reactions="/mascots/chef-reactions.webp"
                    size={115}
                    label="Chef Mascot"
                  />
                </div>
                <div className="hidden 2xl:block">
                  <Mascot
                    directions="/mascots/chef-directions.webp"
                    reactions="/mascots/chef-reactions.webp"
                    size={135}
                    label="Chef Mascot"
                  />
                </div>
              </TooltipTrigger>
              <TooltipContent
                side="top"
                sideOffset={8}
                className="px-3 py-1.5 text-xs font-medium rounded-lg shadow-lg border border-border/70 bg-neutral-900 text-neutral-100 dark:bg-white dark:text-neutral-900 tracking-tight"
              >
                hy, im chef , are u ready to cook with me ?
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>

          <h2 className="mt-1 text-sm md:text-base 2xl:text-lg font-medium text-foreground tracking-tight">
            What are we cooking up today?
          </h2>
        </div>

        {/* Ultra-slim Linear-Style Input Bar */}
        <div className="w-full max-w-xl 2xl:max-w-2xl mb-5 2xl:mb-7">
          <div className="relative group rounded-full border border-border/80 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 pl-4 pr-1.5 py-2 2xl:py-2.5 shadow-2xs transition-all duration-200 focus-within:border-neutral-400 dark:focus-within:border-neutral-600 focus-within:bg-background focus-within:shadow-xs flex items-center gap-2">
            <input
              ref={inputRef}
              type="text"
              value={promptInput}
              onChange={(e) => setPromptInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={placeholderText}
              className="flex-1 bg-transparent text-xs 2xl:text-sm text-foreground placeholder:text-muted-foreground outline-none leading-none"
            />

            <div className="flex items-center gap-1.5 shrink-0">
              <span className="text-[10px] 2xl:text-xs text-muted-foreground hidden sm:inline font-mono pr-0.5">
                ↵
              </span>
              <button
                type="button"
                disabled={!promptInput.trim()}
                className="size-6 2xl:size-7 rounded-full bg-foreground text-background inline-flex items-center justify-center transition-all duration-150 disabled:opacity-25 disabled:cursor-not-allowed hover:opacity-90 active:scale-95"
              >
                <ArrowUp className="size-3.5 2xl:size-4" />
              </button>
            </div>
          </div>
        </div>

        {/* 6 Trending Agents in grid-cols-3 */}
        <div className="w-full mb-5 2xl:mb-7">
          <div className="flex items-center justify-between mb-2 2xl:mb-2.5 px-1">
            <span className="text-[10px] 2xl:text-[11px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
              <TrendingUp className="size-3 2xl:size-3.5 text-muted-foreground" />
              Trending Agents
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 2xl:gap-3">
            {AGENTS.map((agent) => {
              const Icon = agent.icon;
              return (
                <div
                  key={agent.id}
                  className="group relative text-left p-2.5 2xl:p-3.5 rounded-lg border border-border/70 dark:border-neutral-800/80 bg-neutral-50/50 dark:bg-neutral-950/40 hover:border-border dark:hover:border-neutral-700 hover:bg-neutral-100/50 dark:hover:bg-neutral-900/40 transition-all duration-150 flex flex-col justify-between"
                >
                  <div className="flex items-start justify-between gap-2 mb-1 2xl:mb-1.5">
                    <div className="flex items-center gap-2 2xl:gap-2.5">
                      <div className="size-5 2xl:size-6 rounded-md flex items-center justify-center bg-neutral-200/70 dark:bg-neutral-800 text-foreground group-hover:bg-foreground group-hover:text-background transition-colors shrink-0">
                        <Icon className="size-3 2xl:size-3.5" />
                      </div>
                      <span className="text-xs 2xl:text-sm font-medium text-foreground tracking-tight">
                        {agent.name}
                      </span>
                    </div>

                    {agent.badge && (
                      <span className="text-[9px] 2xl:text-[10px] px-1 py-0.2 2xl:px-1.5 2xl:py-0.5 rounded font-mono font-medium bg-neutral-200/60 dark:bg-neutral-800/80 text-muted-foreground border border-border/40 shrink-0">
                        {agent.badge}
                      </span>
                    )}
                  </div>
                  <p className="text-[10px] 2xl:text-[11px] text-muted-foreground line-clamp-1 leading-normal">
                    {agent.role}
                  </p>
                </div>
              );
            })}
          </div>
        </div>

        {/* Try These Recipes: 4 Compact Gradient Boxes */}
        <div className="w-full mt-6 2xl:mt-7">
          <div className="flex items-center justify-between mb-2 2xl:mb-2.5 px-1">
            <span className="text-[10px] 2xl:text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Try These Recipes
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 2xl:gap-4.5">
            {RECIPES.map((recipe) => {
              const Icon = recipe.icon;
              return (
                <div
                  key={recipe.id}
                  onClick={() => handleSelectRecipe(recipe.prompt)}
                  className={`group cursor-pointer rounded-lg border border-border/70 dark:border-neutral-800 bg-gradient-to-br ${recipe.gradient} p-4 2xl:p-4.5 transition-all duration-200 hover:shadow-2xs hover:-translate-y-0.5 flex flex-col justify-between ${recipe.borderHover}`}
                >
                  <div>
                    <div className="flex items-center justify-between gap-1.5 mb-1.5 2xl:mb-2">
                      <span className="text-[9px] 2xl:text-[10px] font-mono tracking-wider uppercase text-muted-foreground font-medium">
                        {recipe.tag}
                      </span>
                      <Icon
                        className={`size-3 2xl:size-3.5 text-muted-foreground transition-colors duration-200 ${recipe.glowColor}`}
                      />
                    </div>
                    <h3 className="text-xs 2xl:text-sm font-medium text-foreground tracking-tight line-clamp-1 leading-snug">
                      {recipe.title}
                    </h3>
                  </div>

                  <div className="mt-2 2xl:mt-3 pt-1.5 border-t border-border/40 dark:border-neutral-800/50 flex items-center justify-between text-[10px] 2xl:text-[11px] text-muted-foreground group-hover:text-foreground transition-colors">
                    <span>Use recipe</span>
                    <span className="transition-transform group-hover:translate-x-0.5 font-mono">
                      →
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
