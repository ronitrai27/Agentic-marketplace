"use client";

import React, { useState, useRef, useEffect } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  Upload,
  Key,
  ArrowRight,
  ArrowUpRight,
  ExternalLink,
  Copy,
  Check,
  Download,
  FileCode2,
  Rocket,
  ChevronDown,
  Box,
  SlidersHorizontal,
  Server,
  ShieldCheck,
  BookOpen,
  Play,
  FileText,
  Package,
} from "lucide-react";
import { RainbowButton } from "@/components/ui/rainbow-button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type PythonPm = "pip" | "uv" | "poetry";
type TsPm = "npm" | "pnpm" | "yarn" | "bun";
type Pm = PythonPm | TsPm;

const pythonCommands: Record<PythonPm, string> = {
  pip: "pip install catelog",
  uv: "uv add catelog",
  poetry: "poetry add catelog",
};

const tsCommands: Record<TsPm, string> = {
  npm: "npm install catelog zod",
  pnpm: "pnpm add catelog zod",
  yarn: "yarn add catelog zod",
  bun: "bun add catelog zod",
};

const pythonCode = `from catelog import CatelogClient

client = CatelogClient(api_key="YOUR_API_KEY")

client.register_agent(
    name="my-agent",
    description="Research agent for web and docs",
    framework="langgraph",
    price_per_run=0.05,
    currency="USD",
    tags=["research", "langgraph"],
)`;

const tsCode = `import { createAgent } from "catelog";
import { z } from "zod";

const agent = createAgent({
  name: "my-agent",
  description: "Research agent for web and docs",
  inputSchema: z.object({ query: z.string() }),
  async execute({ input, stream }) {
    stream.progress(20, "Searching...");
    return { output: { answer: "..." } };
  },
});

agent.listen(3000);`;

type PromptPm = "npm" | "pnpm" | "bun";

const promptInstall: Record<PromptPm, string> = {
  npm: "npm install catelog zod",
  pnpm: "pnpm add catelog zod",
  bun: "bun add catelog zod",
};

const buildTsPrompt = (
  pm: PromptPm,
) => `Catelog turns any AI agent (OpenAI, Vercel AI SDK, LangGraph, or plain TypeScript) into a marketplace-ready HTTP service. You write one execute() function;
Install the Catelog SDK and its guide in your codebase with these commands, then start creating the agent.

\`\`\`bash
${promptInstall[pm]}
npx catelog init                 # asks: add this guide? then TypeScript or Python
npx catelog init --yes           # no questions, installs Catelog-TS.md
npx catelog init --lang py       # installs Catelog-PY.md (placeholder until the Python SDK ships)
npx catelog init --force         # overwrite an existing guide
npx catelog --version
npx catelog --help
\`\`\`

\`\`\`env
CATELOG_SECRET_KEY=cat_sec_live_...     # production auth (required when NODE_ENV=production)
CATELOG_PUBLIC_KEY=cat_pub_live_...     # optional, read-only endpoints
CATELOG_TELEMETRY_URL=https://...       # optional telemetry endpoint
CATELOG_TELEMETRY_DISABLED=false        # optional
CATELOG_SILENT=false                    # optional, hides banner / postinstall output
PORT=3000
\`\`\``;

const frameworks = [
  {
    name: "LangGraph",
    href: "https://langchain-ai.github.io/langgraph/",
    src: "/langgraph.svg",
    className: "dark:invert",
  },
  { name: "CrewAI", href: "https://docs.crewai.com", src: "/crewai.svg" },
  {
    name: "OpenAI SDK",
    href: "https://platform.openai.com/docs/libraries",
    src: "/openai.svg",
    className: "invert dark:invert-0",
  },
  {
    name: "LangChain",
    href: "https://docs.langchain.com",
    src: "/langchain-color.svg",
  },
  {
    name: "Claude SDK",
    href: "https://docs.claude.com/en/api/client-sdks",
    src: "/anthropic.svg",
    className: "invert dark:invert-0",
  },
  {
    name: "Google ADK",
    href: "https://google.github.io/adk-docs/",
    src: "/google.svg",
  },
  {
    name: "LlamaIndex",
    href: "https://docs.llamaindex.ai",
    src: "/llamaindex.svg",
    className: "text-foreground fill-current",
  },
  {
    name: "Pydantic AI",
    href: "https://ai.pydantic.dev",
    src: "/pydantic.svg",
  },
  {
    name: "Mastra",
    href: "https://mastra.ai/docs",
    src: "/mastra.svg",
    className: "dark:invert",
  },
  {
    name: "Vercel AI SDK",
    href: "https://ai-sdk.dev",
    src: "/vercel-wordmark.svg",
    className: "invert dark:invert-0",
  },
];

const steps = [
  {
    icon: Download,
    title: "Install the SDK",
    description:
      "Add the Catelog SDK to your Python or TypeScript project. Create a secret key from Developer credentials.",
    snippet: "npm install catelog zod",
  },
  {
    icon: FileCode2,
    title: "Register your agent",
    description:
      "Wrap your logic with createAgent(), deploy it to a public URL, then add that URL under Creator Space → Register New Agent.",
    snippet: "agent.listen(3000)",
  },
  {
    icon: Rocket,
    title: "Publish to the marketplace",
    description:
      "We read /health and /schema for you. Review the details, set your price per run and publish.",
    snippet: "Review → Set price → Publish",
  },
];

const features = [
  {
    icon: Box,
    title: "Simple and consistent API",
    description: "Same interface across frameworks",
  },
  {
    icon: SlidersHorizontal,
    title: "Register & manage agents",
    description: "Configure metadata, tools, pricing",
  },
  {
    icon: Server,
    title: "Bring your own server (BYOS)",
    description: "Host anywhere or use our hosting (soon)",
  },
  {
    icon: ShieldCheck,
    title: "Secure and production ready",
    description: "API keys, rate limits, usage tracking",
  },
  {
    icon: FileText,
    title: "Detailed documentation",
    description: "Guides, examples and best practices",
  },
];

const KEYWORDS = /^(from|import|const|await|async|new|return)$/;

/** Code panels stay dark in both themes. */
function Highlight({ code }: { code: string }) {
  const parts = code.split(/("[^"]*"|\b\d+(?:\.\d+)?\b|\b[a-z]+\b)/g);
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith('"') || /^\d/.test(part)) {
          return (
            <span
              key={i}
              className={
                part.startsWith('"') ? "text-emerald-400" : "text-amber-300"
              }
            >
              {part}
            </span>
          );
        }
        if (KEYWORDS.test(part)) {
          return (
            <span key={i} className="text-purple-400">
              {part}
            </span>
          );
        }
        return (
          <span key={i} className="text-neutral-300">
            {part}
          </span>
        );
      })}
    </>
  );
}

function PmLogo({ pm }: { pm: Pm }) {
  if (pm === "pip") {
    return <Package className="size-3.5 shrink-0" />;
  }
  return (
    <Image
      src={`/${pm}.svg`}
      alt={pm}
      width={14}
      height={14}
      className="size-3.5 shrink-0 object-contain"
    />
  );
}

function CopyIcon({
  copied,
  className,
}: {
  copied: boolean;
  className?: string;
}) {
  return copied ? (
    <Check className={className} />
  ) : (
    <Copy className={className} />
  );
}

function CodeCard<T extends Pm>({
  className,
  icon,
  language,
  code,
  managers,
  commands,
}: {
  className?: string;
  icon: string;
  language: string;
  code: string;
  managers: T[];
  commands: Record<T, string>;
}) {
  const [pm, setPm] = useState<T>(managers[0]);
  const [open, setOpen] = useState(false);
  const [copiedCmd, setCopiedCmd] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  const copy = (text: string, set: (v: boolean) => void) => {
    navigator.clipboard.writeText(text);
    set(true);
    setTimeout(() => set(false), 2000);
  };

  return (
    <div
      className={`flex flex-col rounded-xl border border-neutral-800 bg-[#0d1117] text-white overflow-hidden ${className ?? ""}`}
    >
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-neutral-800 bg-[#161b22]">
        <div className="flex items-center gap-2">
          <Image
            src={icon}
            alt={language}
            width={16}
            height={16}
            className="rounded-xs"
          />
          <span className="text-xs font-medium text-neutral-200">
            {language}
          </span>
        </div>

        <div className="relative flex items-center" ref={ref}>
          <div className="flex items-center rounded-md border border-neutral-700/80 bg-neutral-900/90">
            <button
              type="button"
              onClick={() => setOpen(!open)}
              title="Select package manager"
              className="flex items-center gap-1.5 px-2 py-1 text-white cursor-pointer"
            >
              <PmLogo pm={pm} />
              <span className="text-[11px] font-mono">{pm}</span>
              <ChevronDown className="size-3 text-neutral-400" />
            </button>
            <div className="h-3.5 w-px bg-neutral-700/80" />
            <button
              type="button"
              onClick={() => copy(commands[pm], setCopiedCmd)}
              title={`Copy: ${commands[pm]}`}
              className="px-1.5 py-1 text-neutral-400 hover:text-white hover:bg-neutral-800/60 rounded-r-md transition-colors cursor-pointer"
            >
              <CopyIcon copied={copiedCmd} className="size-3" />
            </button>
          </div>

          {open && (
            <div className="absolute right-0 top-full mt-1.5 w-36 rounded-lg border border-neutral-700 bg-[#161b22] shadow-xl p-1 z-30 flex flex-col gap-0.5 animate-in fade-in-0 zoom-in-95">
              {managers.map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => {
                    setPm(m);
                    setOpen(false);
                  }}
                  className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded text-xs transition-colors cursor-pointer ${
                    pm === m
                      ? "bg-neutral-800 text-white"
                      : "text-neutral-400 hover:text-white hover:bg-neutral-800/60"
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <PmLogo pm={m} />
                    <span className="font-mono">{m}</span>
                  </span>
                  {pm === m && <Check className="size-3" />}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="relative p-4 font-mono text-xs leading-relaxed overflow-x-auto flex-1">
        <button
          type="button"
          onClick={() => copy(code, setCopiedCode)}
          title="Copy code"
          className="absolute top-3 right-3 p-1 rounded border border-neutral-700/80 bg-neutral-900/90 text-neutral-400 hover:text-white transition-colors cursor-pointer"
        >
          <CopyIcon copied={copiedCode} className="size-3" />
        </button>
        <pre>
          <code>
            <Highlight code={code} />
          </code>
        </pre>
      </div>
    </div>
  );
}

function AgentPromptDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [lang, setLang] = useState<"typescript" | "python">("typescript");
  const [pm, setPm] = useState<PromptPm>("npm");
  const [copied, setCopied] = useState(false);

  const copy = () => {
    navigator.clipboard.writeText(buildTsPrompt(pm));
    setCopied(true);
    setTimeout(() => {
      setCopied(false);
      onOpenChange(false);
    }, 900);
  };

  const options = [
    {
      id: "typescript",
      label: "TypeScript",
      icon: "/typescript.png",
      note: "catelog 1.1.2",
    },
    { id: "python", label: "Python", icon: "/python.png", note: "Coming soon" },
  ] as const;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Copy agent prompt</DialogTitle>
          <DialogDescription>
            Choose a language. Paste the prompt into your coding assistant to
            set up and build your agent.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-2">
          {options.map((o) => {
            const disabled = o.id === "python";
            const active = lang === o.id;
            return (
              <button
                key={o.id}
                type="button"
                disabled={disabled}
                onClick={() => setLang(o.id)}
                className={`flex items-center gap-2.5 rounded-lg border p-3 text-left transition-colors ${
                  active
                    ? "border-foreground bg-muted/60"
                    : "border-border hover:bg-muted/40"
                } ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
              >
                <Image
                  src={o.icon}
                  alt={o.label}
                  width={18}
                  height={18}
                  className="rounded-xs"
                />
                <span className="leading-tight">
                  <span className="block text-xs font-medium text-foreground">
                    {o.label}
                  </span>
                  <span className="block text-[11px] text-muted-foreground">
                    {o.note}
                  </span>
                </span>
              </button>
            );
          })}
        </div>

        {lang === "typescript" && (
          <div className="space-y-1.5">
            <p className="text-[11px] text-muted-foreground">Package manager</p>
            <div className="flex gap-1 rounded-lg border border-border p-1">
              {(["npm", "pnpm", "bun"] as PromptPm[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setPm(m)}
                  className={`flex-1 inline-flex items-center justify-center gap-1.5 rounded-md py-1 text-xs font-mono transition-colors cursor-pointer ${
                    pm === m
                      ? "bg-muted text-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <PmLogo pm={m} />
                  {m}
                </button>
              ))}
            </div>
            <code className="block rounded-md border border-border bg-muted/50 px-2.5 py-1.5 text-[11px] font-mono text-foreground/80">
              {promptInstall[pm]}
            </code>
          </div>
        )}

        <DialogFooter>
          <button
            type="button"
            onClick={copy}
            className="inline-flex items-center justify-center gap-1.5 h-9 px-4 rounded-md text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors cursor-pointer"
          >
            <CopyIcon copied={copied} className="size-3.5" />
            <span>{copied ? "Copied" : "Copy prompt"}</span>
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function CreatorPage() {
  const [promptOpen, setPromptOpen] = useState(false);

  return (
    <div className="flex-1 h-full overflow-y-auto scrollbar-thin px-6 py-8 lg:px-10 space-y-12 bg-background">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
        <div className="max-w-xl">
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-foreground">
            Creator Space
          </h1>
          <p className="text-sm sm:text-base font-medium text-foreground mt-1.5">
            Build. Publish. Monetize your AI agents.
          </p>
          <p className="text-xs sm:text-sm text-muted-foreground mt-1.5 leading-relaxed">
            Use our SDK to register your agent, manage metadata, set pricing and
            publish it to the Catelog marketplace.
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <Link
            href="/space/creator"
            className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-md text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors cursor-pointer"
          >
            <Upload className="size-3.5" />
            <span>Publish an agent</span>
          </Link>
          <Link
            href="/space/creator/credentials"
            className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-md text-xs font-medium border border-border bg-primary-foreground dark:bg-white dark:text-black text-foreground hover:bg-muted transition-colors cursor-pointer"
          >
            <Key className="size-3.5" />
            <span>Get API key</span>
          </Link>
        </div>
      </div>

      {/* Works with 10+ agent frameworks */}
      <section className="space-y-4">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-foreground">
              Works with 10+ agent frameworks
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Use the Catelog SDK with your existing stack.
            </p>
          </div>
          <Link
            href="/docs"
            className="text-xs font-medium text-muted-foreground hover:text-foreground inline-flex items-center gap-1 transition-colors cursor-pointer"
          >
            <span>View all integrations</span>
            <ArrowRight className="size-3" />
          </Link>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-px rounded-xl border border-border bg-border overflow-hidden">
          {frameworks.map((fw) => (
            <a
              key={fw.name}
              href={fw.href}
              target="_blank"
              rel="noopener noreferrer"
              title={`${fw.name} documentation`}
              className="group relative flex flex-col items-center justify-center gap-3 px-3 py-6 bg-card hover:bg-muted/50 transition-colors cursor-pointer"
            >
              <ArrowUpRight className="absolute top-2.5 right-2.5 size-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
              <div className="h-8 flex items-center justify-center">
                <Image
                  src={fw.src}
                  alt={fw.name}
                  width={40}
                  height={40}
                  className={`h-8 w-auto max-w-[110px] ${fw.className ?? ""}`}
                />
              </div>
              <span className="text-xs text-muted-foreground group-hover:text-foreground transition-colors text-center truncate w-full">
                {fw.name}
              </span>
            </a>
          ))}
        </div>
      </section>

      {/* Catelog SDK */}
      <section id="sdk" className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
          <div>
            <h2 className="text-base sm:text-lg font-semibold text-foreground">
              Catelog SDK
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Available for Python and TypeScript. Lightweight, framework
              agnostic and production ready.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <RainbowButton
              type="button"
              size="sm"
              onClick={() => setPromptOpen(true)}
              title="Copy agent prompt"
              className="h-9 rounded-md px-3.5 text-xs font-medium gap-1.5 cursor-pointer"
            >
              <span>Copy Agent Prompt</span>
              <Copy className="size-3.5 opacity-80" />
            </RainbowButton>

            <a
              href="https://github.com"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md text-xs font-medium border border-border bg-white text-black hover:bg-muted transition-colors cursor-pointer"
            >
              <Image
                src="/github.png"
                alt="GitHub"
                width={14}
                height={14}
                className="dark:invert"
              />
              <span>View on GitHub</span>
              <ExternalLink className="size-3 text-muted-foreground" />
            </a>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          <CodeCard
            className="lg:col-span-5"
            icon="/python.png"
            language="Python"
            code={pythonCode}
            managers={["pip", "uv", "poetry"] as PythonPm[]}
            commands={pythonCommands}
          />
          <CodeCard
            className="lg:col-span-4"
            icon="/typescript.png"
            language="TypeScript"
            code={tsCode}
            managers={["npm", "pnpm", "yarn", "bun"] as TsPm[]}
            commands={tsCommands}
          />

          {/* Features, docs & demo */}
          <div className="lg:col-span-3 flex flex-col justify-between rounded-xl border border-border bg-card p-4">
            <div className="space-y-4">
              {features.map((f) => (
                <div key={f.title} className="flex items-start gap-3">
                  <f.icon className="size-4 text-muted-foreground shrink-0 mt-0.5" />
                  <div className="leading-tight">
                    <p className="text-xs font-medium text-foreground">
                      {f.title}
                    </p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      {f.description}
                    </p>
                  </div>
                </div>
              ))}
            </div>

            <div className="pt-4 border-t border-border flex flex-col gap-2 mt-4">
              <Link
                href="/docs"
                className="w-full inline-flex items-center justify-between px-3 py-1.5 rounded-md text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors cursor-pointer"
              >
                <span>Read documentation</span>
                <ArrowRight className="size-3.5" />
              </Link>
              <button
                type="button"
                onClick={() => {
                  alert("Interactive SDK playground & demo sandbox loading...");
                }}
                className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium border border-border hover:bg-muted text-foreground transition-colors cursor-pointer"
              >
                <Play className="size-3 fill-current" />
                <span>Try quick demo</span>
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Publish your agent in 3 steps */}
      <section className="space-y-4">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-foreground">
              Publish your agent in 3 steps
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              From install to live on the marketplace.
            </p>
          </div>
          <Link
            href="/docs"
            className="text-xs font-medium text-muted-foreground hover:text-foreground inline-flex items-center gap-1 transition-colors cursor-pointer"
          >
            <span>View detailed guide</span>
            <ArrowRight className="size-3" />
          </Link>
        </div>

        <ol className="grid grid-cols-1 md:grid-cols-3 gap-px rounded-xl border border-border bg-border overflow-hidden">
          {steps.map((step, i) => (
            <li
              key={step.title}
              className="flex flex-col gap-4 p-5 bg-linear-to-br from-card to-muted/70"
            >
              <div className="flex items-center justify-between">
                <div className="size-8 rounded-md border border-border bg-muted/50 flex items-center justify-center">
                  <step.icon className="size-4 text-foreground" />
                </div>
                <span className="text-[11px] font-mono text-muted-foreground">
                  0{i + 1}
                </span>
              </div>
              <div>
                <h3 className="text-sm font-medium text-foreground">
                  {step.title}
                </h3>
                <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">
                  {step.description}
                </p>
              </div>
              <code className="mt-auto self-start rounded-md border border-border bg-muted/50 px-2 py-1 text-[11px] font-mono text-foreground/80">
                {step.snippet}
              </code>
            </li>
          ))}
        </ol>
      </section>

      {/* Documentation & Developer credentials */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="flex items-start gap-3 p-5 rounded-xl border border-border bg-card">
          <div className="size-9 rounded-md border border-border bg-muted/50 flex items-center justify-center shrink-0">
            <BookOpen className="size-4 text-foreground" />
          </div>
          <div>
            <h3 className="text-sm font-medium text-foreground">
              Documentation
            </h3>
            <p className="text-xs text-muted-foreground mt-1 leading-snug">
              Installation guides, API reference, examples, and framework
              specific tutorials.
            </p>
            <Link
              href="/docs"
              className="inline-flex items-center gap-1 text-xs font-medium text-foreground hover:underline underline-offset-4 mt-2.5 cursor-pointer"
            >
              <span>Read full documentation</span>
              <ArrowRight className="size-3" />
            </Link>
          </div>
        </div>

        <div
          id="dev-credentials"
          className="flex items-start justify-between gap-4 p-5 rounded-xl border border-border bg-card"
        >
          <div className="flex items-start gap-3">
            <div className="size-9 rounded-md border border-border bg-muted/50 flex items-center justify-center shrink-0">
              <Key className="size-4 text-foreground" />
            </div>
            <div>
              <h3 className="text-sm font-medium text-foreground">
                Developer credentials
              </h3>
              <p className="text-xs text-muted-foreground mt-1 leading-snug">
                Create and manage API keys for SDK authentication.
              </p>
            </div>
          </div>
          <Link
            href="/space/creator/credentials"
            className="shrink-0 px-3 py-1.5 rounded-md text-xs font-medium border border-border bg-background hover:bg-muted text-foreground transition-colors cursor-pointer"
          >
            Manage API keys
          </Link>
        </div>
      </div>
      <AgentPromptDialog open={promptOpen} onOpenChange={setPromptOpen} />
    </div>
  );
}
