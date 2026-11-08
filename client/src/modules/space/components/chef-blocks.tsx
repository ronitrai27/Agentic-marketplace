"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Check, SearchIcon, Star, TerminalIcon } from "lucide-react";
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from "@/components/ui/trace";
import {
  CodeBlock,
  CodeBlockContent,
  CodeBlockHeader,
  CodeBlockTitle,
} from "@/components/ui/code-block";
import { DotmSquare1 } from "@/components/ui/dotm-square-1";
import { selectionMessage } from "@/chef/tools/selection";
import { AgentLogo } from "./agent-logo";
import { ModelLogos } from "./agent-card";

/** Small light-grey dot matrix, used instead of a spinner while the chef works. */
export function ThinkingMatrix() {
  return (
    <DotmSquare1
      size={14}
      dotSize={2}
      speed={1.8}
      color="#c4c4c4"
      opacityPeak={0.75}
    />
  );
}

export type PickAgent = {
  slug: string;
  name: string;
  logoUrl?: string;
  ratingAvg: number;
  ratingCount: number;
  models: { id: string; provider?: string }[];
};

/** Everything the heavy model shows under a user message, in the order it happened. */
export type Block =
  | { kind: "reasoning"; id: string; text: string; done: boolean; durationMs?: number }
  | {
      kind: "tool";
      id: string;
      step: number;
      name: string;
      args: unknown;
      status: "running" | "done" | "error";
      output?: string;
    }
  | {
      kind: "agents";
      id: string;
      step: number;
      needsChoice: boolean;
      preselect?: string;
      agents: PickAgent[];
    };

const fmtSecs = (ms: number) => `${Math.max(1, Math.round(ms / 1000))}s`;

// ─── reasoning ───

/** "Thought for 5s": the model's reasoning summary, open while it streams and folded away when done. */
function ReasoningBlock({ b }: { b: Extract<Block, { kind: "reasoning" }> }) {
  const [open, setOpen] = useState(true);
  useEffect(() => {
    if (!b.done) return;
    const t = setTimeout(() => setOpen(false), 700);
    return () => clearTimeout(t);
  }, [b.done]);

  return (
    <Trace>
      <TraceCollapsible open={open} onOpenChange={setOpen}>
        <TraceCollapsibleTrigger>
          <TraceLine status={b.done ? undefined : "running"}>
            {!b.done && (
              <TraceIcon>
                <ThinkingMatrix />
              </TraceIcon>
            )}
            <TraceTitle>
              {b.done ? `Thought for ${fmtSecs(b.durationMs ?? 0)}` : "Thinking…"}
            </TraceTitle>
          </TraceLine>
        </TraceCollapsibleTrigger>
        <TraceCollapsibleContent>
          <p className="whitespace-pre-wrap text-[13px] leading-6">{b.text}</p>
        </TraceCollapsibleContent>
      </TraceCollapsible>
    </Trace>
  );
}

// ─── tools ───

function prettyArgs(args: unknown): string {
  try {
    return JSON.stringify(args, null, 2);
  } catch {
    return String(args);
  }
}

const TOOL_LABELS: Record<
  string,
  { running: string; done: (a: Record<string, unknown>) => string; failed: string }
> = {
  find_agents: {
    running: "Searching agents…",
    done: (a) =>
      a.mode === "name"
        ? `Looked up agent “${String(a.query ?? "").slice(0, 40)}”`
        : `Searched agents for “${String(a.query ?? "").slice(0, 40)}”`,
    failed: "Failed to search agents",
  },
  get_agent_details: {
    running: "Reading agent details…",
    done: (a) => {
      const names = Array.isArray(a.names) ? a.names.map(String) : [];
      return names.length ? `Read details of ${names.map((n) => `“${n.slice(0, 30)}”`).join(", ")}` : "Read agent details";
    },
    failed: "Failed to read agent details",
  },
};

/** One tool run: a Trace line that opens to the input and the result in code blocks. */
function ToolBlock({ b }: { b: Extract<Block, { kind: "tool" }> }) {
  const label = TOOL_LABELS[b.name];
  const args = (b.args ?? {}) as Record<string, unknown>;
  const title =
    b.status === "running"
      ? (label?.running ?? `Running ${b.name}…`)
      : b.status === "error"
        ? (label?.failed ?? `Failed to run ${b.name}`)
        : (label?.done(args) ?? `Ran ${b.name}`);
  const Icon = b.name === "find_agents" ? SearchIcon : TerminalIcon;

  const line = (
    <TraceLine status={b.status === "running" ? "running" : b.status === "error" ? "error" : undefined}>
      <TraceIcon>{b.status === "running" ? <ThinkingMatrix /> : <Icon />}</TraceIcon>
      <TraceTitle>{title}</TraceTitle>
    </TraceLine>
  );

  // nothing to expand until the tool has answered
  if (b.status === "running") return <Trace>{line}</Trace>;

  return (
    <Trace>
      <TraceCollapsible>
        <TraceCollapsibleTrigger>{line}</TraceCollapsibleTrigger>
        <TraceCollapsibleContent className="flex flex-col gap-2 border-l pl-4">
          <CodeBlock size="sm" className="border-0 bg-muted/60 dark:bg-muted/40">
            <CodeBlockHeader>
              <CodeBlockTitle>Input</CodeBlockTitle>
            </CodeBlockHeader>
            <CodeBlockContent wrap>{prettyArgs(b.args)}</CodeBlockContent>
          </CodeBlock>
          {b.output && (
            <CodeBlock
              size="sm"
              variant={b.status === "error" ? "destructive" : "default"}
              className="border-0 bg-muted/60 dark:bg-muted/40"
            >
              <CodeBlockHeader>
                <CodeBlockTitle>{b.status === "error" ? "Error" : "Result"}</CodeBlockTitle>
              </CodeBlockHeader>
              <CodeBlockContent wrap>{b.output}</CodeBlockContent>
            </CodeBlock>
          )}
        </TraceCollapsibleContent>
      </TraceCollapsible>
    </Trace>
  );
}

// ─── agent picker ───

function AgentOption({
  a,
  selected,
  locked,
  onPick,
}: {
  a: PickAgent;
  selected: boolean;
  locked: boolean;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={locked && !selected}
      onClick={onPick}
      className={`flex w-[calc((100%-1rem)/3)] min-w-[220px] shrink-0 snap-start flex-col justify-between gap-2.5 rounded-lg border p-2.5 text-left transition-all ${
        selected
          ? "border-foreground/70 bg-neutral-50 shadow-xs ring-1 ring-foreground/20 dark:bg-neutral-950/60"
          : "border-border/70 bg-neutral-50/50 hover:border-foreground/30 dark:border-neutral-800/80 dark:bg-neutral-950/40"
      } ${locked && !selected ? "opacity-40" : ""}`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <AgentLogo name={a.name} logoUrl={a.logoUrl} className="size-7 shrink-0 text-xs" />
          <span className="truncate text-xs font-medium tracking-tight text-foreground">{a.name}</span>
        </div>
        <span
          className={`flex size-4 shrink-0 items-center justify-center rounded-full border ${
            selected ? "border-foreground bg-foreground text-background" : "border-border"
          }`}
        >
          {selected && <Check className="size-3" strokeWidth={3} />}
        </span>
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1 text-xs tabular-nums text-foreground">
          <Star className="size-3.5 fill-amber-400 text-amber-400" strokeWidth={1.5} />
          {a.ratingAvg.toFixed(1)}
          <span className="text-muted-foreground">
            ({a.ratingCount} review{a.ratingCount === 1 ? "" : "s"})
          </span>
        </span>
        <ModelLogos models={a.models} />
      </div>
    </button>
  );
}

/** Pick one agent, then confirm: confirming sends "Selected agent: "<name>"" as the user's next message. */
function AgentPicker({
  b,
  onConfirm,
}: {
  b: Extract<Block, { kind: "agents" }>;
  onConfirm: (message: string) => void;
}) {
  const [slug, setSlug] = useState<string | null>(b.preselect ?? null);
  const [locked, setLocked] = useState(false);
  const chosen = b.agents.find((a) => a.slug === slug);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: "easeOut" }}
      className="flex w-full flex-col gap-2.5"
    >
      {/* one row that scrolls sideways when there are more agents than fit */}
      <div
        role="radiogroup"
        aria-label="Choose an agent"
        className="scrollbar-thin -mx-1 flex snap-x snap-mandatory gap-2 overflow-x-auto px-1 pb-2"
      >
        {b.agents.map((a) => (
          <AgentOption
            key={a.slug}
            a={a}
            selected={a.slug === slug}
            locked={locked}
            onPick={() => !locked && setSlug(a.slug)}
          />
        ))}
      </div>
      <div className="flex items-center justify-end gap-2">
        {!locked && (
          <span className="text-[11px] text-muted-foreground">
            {chosen ? chosen.name : "Pick an agent"}
          </span>
        )}
        <button
          type="button"
          disabled={!chosen || locked}
          onClick={() => {
            if (!chosen) return;
            setLocked(true);
            onConfirm(selectionMessage(chosen.name));
          }}
          className="inline-flex h-7 items-center gap-1.5 rounded-md bg-foreground px-3 text-xs font-medium text-background transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-30"
        >
          {locked ? (
            <>
              <Check className="size-3.5" /> Selected
            </>
          ) : (
            "Confirm"
          )}
        </button>
      </div>
    </motion.div>
  );
}

/** Reasoning, tool runs and the agent picker for one user message. */
export function ChefBlocks({
  blocks,
  onConfirm,
}: {
  blocks: Block[];
  onConfirm: (message: string) => void;
}) {
  // Within one step the thinking always sits above the tool and the picker, whichever arrived first
  const rank = (b: Block) => (b.kind === "reasoning" ? 0 : b.kind === "tool" ? 1 : 2);
  const stepOf = (b: Block) => (b.kind === "reasoning" ? Number(b.id.slice(1)) || 0 : b.step);
  const ordered = blocks
    .map((b, i) => ({ b, i }))
    .sort((x, y) => stepOf(x.b) - stepOf(y.b) || rank(x.b) - rank(y.b) || x.i - y.i)
    .map((x) => x.b);
  return (
    <div className="flex flex-col gap-2.5 px-1">
      {ordered.map((b) =>
        b.kind === "reasoning" ? (
          <ReasoningBlock key={`${b.kind}-${b.id}`} b={b} />
        ) : b.kind === "tool" ? (
          <ToolBlock key={`${b.kind}-${b.id}`} b={b} />
        ) : (
          <AgentPicker key={`${b.kind}-${b.id}`} b={b} onConfirm={onConfirm} />
        ),
      )}
    </div>
  );
}
