"use client";

import { useState, useRef, useEffect } from "react";
import { Mascot } from "page-mascot";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { toast } from "sonner";
import { RecipeCards } from "./recipe-cards";
import {
  Copy,
  ArrowUp,
  Bot,
  Search,
  Code2,
  FileText,
  BarChart3,
  ShieldCheck,
  TrendingUp,
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

interface AgentTarget {
  id: string;
  name: string;
  src: string;
  invertOnDark?: boolean;
}

const AGENT_TARGETS: AgentTarget[] = [
  { id: "codex", name: "Codex", src: "/codex-color.svg" },
  { id: "claude-code", name: "Claude Code", src: "/claudecode-color.svg" },
  { id: "cursor", name: "Cursor", src: "/cursor.svg", invertOnDark: true },
  { id: "hermes", name: "Hermes Agent", src: "/hermesagent.svg" },
];

// Demo only: copies an empty prompt for now.
const copyAgentPrompt = async (target?: string) => {
  try {
    await navigator.clipboard.writeText("");
  } catch {
    // clipboard unavailable; still show feedback in demo mode
  }
  toast.success(target ? `Prompt copied for ${target}` : "Prompt copied");
};

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

          <div className="mt-2 flex flex-wrap items-center justify-center gap-x-3 gap-y-2">
            {/* <h2 className="text-sm md:text-base 2xl:text-lg font-medium text-foreground tracking-tight">
              What are we cooking up today?
            </h2> */}
            <button
              type="button"
              onClick={() => copyAgentPrompt()}
              className="inline-flex items-center gap-2 rounded-full border border-border dark:border-neutral-800 bg-linear-to-br from-white via-white to-neutral-300 px-3 py-1 text-[11px] 2xl:text-xs font-medium text-foreground tracking-tight shadow-2xs transition-all duration-150 hover:bg-neutral-100/60 dark:hover:bg-neutral-900 active:scale-[0.98]"
            >
              Plug your agent into catelog
              <span className="flex items-center gap-1.5">
                {AGENT_TARGETS.map((t) => (
                  <img
                    key={t.id}
                    src={t.src}
                    alt={t.name}
                    className={`size-5 ${t.invertOnDark ? "dark:invert" : ""}`}
                  />
                ))}
              </span>
            </button>
          </div>
        </div>

        {/* Ultra-slim Linear-Style Input Bar */}
        <div
          className={`relative w-full mb-5 mt-4 transition-[max-width] duration-1000 ease-in-out ${
            promptInput.length > 0 ? "max-w-3xl" : "max-w-2xl"
          }`}
        >
          {/* Outer ring (Cloudflare-style) */}
          <div className="rounded-lg border border-border/30 dark:border-neutral-800/80 bg-gray-100 dark:bg-neutral-900/40 p-1">
            <div className="relative group rounded-md border border-border/80 dark:border-neutral-800 bg-white dark:bg-neutral-900 pl-4 pr-1.5 py-2 2xl:py-2.5 shadow-2xs transition-all duration-200 focus-within:border-neutral-400 dark:focus-within:border-neutral-600 focus-within:bg-background focus-within:shadow-xs flex items-center gap-2">
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
                <span className="text-lg text-muted-foreground hidden sm:inline font-mono pr-0.5">
                  ↵
                </span>
                <button
                  type="button"
                  disabled={!promptInput.trim()}
                  className="size-6 2xl:size-7 rounded-md bg-foreground text-background inline-flex items-center justify-center transition-all duration-150 disabled:opacity-25 disabled:cursor-not-allowed hover:opacity-90 active:scale-95"
                >
                  <ArrowUp className="size-3.5 2xl:size-4" />
                </button>

                {/* Copy prompt: inside input bar to the right of the send button */}
                <div className="group/copy flex items-center">
                  <button
                    type="button"
                    aria-label="Copy prompt"
                    onClick={() => copyAgentPrompt()}
                    className="size-6 2xl:size-7 rounded-md border border-border/80 dark:border-neutral-800 bg-background dark:bg-neutral-800/80 inline-flex items-center justify-center text-muted-foreground transition-colors hover:bg-neutral-200/70 dark:hover:bg-neutral-800 hover:text-foreground active:scale-95"
                  >
                    <Copy className="size-3.5 2xl:size-4" />
                  </button>
                  <div className="flex items-center gap-0.5 overflow-hidden max-w-0 opacity-0 transition-all duration-300 ease-out group-hover/copy:max-w-32 group-hover/copy:opacity-100 group-hover/copy:ml-1">
                    {AGENT_TARGETS.map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        title={`Copy prompt for ${t.name}`}
                        aria-label={`Copy prompt for ${t.name}`}
                        onClick={() => copyAgentPrompt(t.name)}
                        className="size-6 2xl:size-7 shrink-0 rounded-md inline-flex items-center justify-center transition-colors hover:bg-neutral-200/70 dark:hover:bg-neutral-800 active:scale-95"
                      >
                        <img
                          src={t.src}
                          alt=""
                          className={`size-5 ${t.invertOnDark ? "dark:invert" : ""}`}
                        />
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* 3 Trending Agents in grid-cols-3 */}
        <div className="w-full mb-5 2xl:mb-7">
          <div className="flex items-center justify-between mb-2 2xl:mb-2.5 px-1">
            <span className="text-[10px] 2xl:text-[11px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
              <TrendingUp className="size-3 2xl:size-3.5 text-muted-foreground" />
              Trending Agents
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 2xl:gap-3">
            {AGENTS.slice(0, 3).map((agent) => {
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

          <RecipeCards onSelect={handleSelectRecipe} />
        </div>
      </div>
    </div>
  );
}
