"use client";

import { useState, useRef, useEffect } from "react";
import { Mascot } from "page-mascot";
import { AnimatePresence, motion } from "framer-motion";
import { ChefBottomInput } from "./chef-bottom-input";
import { useRouter } from "next/navigation";
import { ChefMessages, useChefChat } from "./chef-chat";
import { ChefChatActions } from "./chef-chat-actions";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { toast } from "sonner";
import { authClient } from "@/lib/auth-client";
import { RecipeCards } from "./recipe-cards";
import { TryAgents } from "./try-agents";
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

/** Content that fades and folds away smoothly once the first message is sent. */
function Fade({
  show,
  children,
  delay = 0,
}: {
  show: boolean;
  children: React.ReactNode;
  /** Seconds to wait before the entrance animation, for a staggered reveal. */
  delay?: number;
}) {
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          className="flex w-full flex-col items-center overflow-hidden"
          initial={{ opacity: 0, y: 14 }}
          animate={{
            opacity: 1,
            y: 0,
            transition: { duration: 0.55, ease: "easeOut", delay },
          }}
          exit={{
            opacity: 0,
            height: 0,
            transition: { duration: 0.6, ease: "easeInOut" },
          }}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function SpaceChefMascot({ chatId }: { chatId?: string }) {
  const [sent, setSent] = useState(!!chatId);
  const [activeChatId, setActiveChatId] = useState<string | null>(
    chatId ?? null,
  );
  const chat = useChefChat(activeChatId);
  const router = useRouter();
  const { data: session, isPending: sessionPending } = authClient.useSession();

  /** Back to the start screen. The chat stays in History. */
  const clearChat = () => {
    setSent(false);
    setActiveChatId(null);
    router.push("/space");
  };

  /** First message creates the chat id and puts it in the URL; every message then goes to the chef route. */
  const sendMessage = (text: string) => {
    // Guests (and a missing session) can look around but not chat: say so before anything is sent
    let guest = false;
    try {
      guest = localStorage.getItem("catelxg_guest_mode") === "true";
    } catch {
      /* storage unavailable: the server still checks */
    }
    if (guest || (!sessionPending && !session)) {
      toast.error("You need to log in first.", {
        description: "Sign in to chat with the chef.",
        action: { label: "Log in", onClick: () => router.push("/auth") },
      });
      return;
    }
    let id = activeChatId;
    if (!id) {
      id = crypto.randomUUID();
      setActiveChatId(id);
      window.history.replaceState(
        window.history.state,
        "",
        `/space/chat/${id}`,
      );
    }
    setSent(true);
    void chat.send(id, text);
  };
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
      submit();
    }
  };

  const submit = () => {
    const text = promptInput.trim();
    if (!text) return;
    setPromptInput("");
    sendMessage(text);
  };

  return (
    <div className="relative w-full h-full flex flex-col select-none">
      {sent && <ChefChatActions onClear={clearChat} />}
      <div className="flex-1 min-h-0 flex flex-col overflow-y-auto px-4 py-4 md:py-6 2xl:py-10 scrollbar-thin">
        <motion.div
          layout
          className={`max-w-4xl 2xl:max-w-5xl w-full mx-auto flex flex-col items-center ${sent ? "mt-0 flex-1" : "my-auto"}`}
        >
          {/* Mascot & Heading */}
          <motion.div
            initial={{ opacity: 0, scale: 0.92 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.5, ease: "easeOut" }}
            className="relative flex flex-col items-center mb-3 2xl:mb-5"
          >
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
                      size={sent ? 90 : 120}
                      label="Chef Mascot"
                    />
                  </div>
                  <div className="hidden 2xl:block">
                    <Mascot
                      directions="/mascots/chef-directions.webp"
                      reactions="/mascots/chef-reactions.webp"
                      size={sent ? 90 : 120}
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
              <Fade show={!sent} delay={0.12}>
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
              </Fade>
            </div>
          </motion.div>

          <Fade show={!sent} delay={0.24}>
            {/* Ultra-slim Linear-Style Input Bar */}
            <div
              className={`relative w-full mb-5 mt-4 transition-[max-width] duration-1000 ease-in-out ${
                promptInput.length > 0 ? "max-w-3xl" : "max-w-2xl"
              }`}
            >
              {/* Outer ring (Cloudflare-style) */}
              <div className="rounded-2xl! border border-border/30 dark:border-neutral-800/80 bg-gray-100 dark:bg-neutral-900/40 p-1">
                <div className="relative group rounded-xl! border border-border/80 dark:border-neutral-800 bg-white dark:bg-neutral-900 pl-4 pr-1.5 py-2 2xl:py-2.5 shadow-2xs transition-all duration-200 focus-within:border-neutral-400 dark:focus-within:border-neutral-600 focus-within:bg-background focus-within:shadow-xs flex items-center gap-2">
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
                      onClick={submit}
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
          </Fade>

          <Fade show={!sent} delay={0.36}>
            <TryAgents />
          </Fade>

          <Fade show={!sent} delay={0.48}>
            {/* Try These Recipes: 4 Compact Gradient Boxes */}
            <div className="w-full mt-6 2xl:mt-7">
              <div className="flex items-center justify-between mb-2 2xl:mb-2.5 px-1">
                <span className="text-xs font-semibold uppercase tracking-wider ">
                  Try These Recipes
                </span>
              </div>

              <RecipeCards onSelect={handleSelectRecipe} />
            </div>
          </Fade>
          {sent && (
            <ChefMessages
              chatId={activeChatId}
              onAnswer={chat.answer}
              messages={chat.messages}
              traces={chat.traces}
              blocks={chat.blocks}
              busy={chat.busy}
              onSelectAgent={sendMessage}
            />
          )}
        </motion.div>
      </div>
      {sent && (
        <ChefBottomInput
          onSubmit={sendMessage}
          lockedReason={
            chat.openProposal
              ? "Confirm or deny the agent run above to continue"
              : undefined
          }
        />
      )}
    </div>
  );
}
