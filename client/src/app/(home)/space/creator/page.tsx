"use client";

import React, { useState, useRef, useEffect } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  Upload,
  Key,
  ArrowRight,
  ExternalLink,
  Copy,
  Check,
  Code2,
  FileText,
  Rocket,
  ChevronRight,
  ChevronDown,
  Box,
  SlidersHorizontal,
  Server,
  ShieldCheck,
  BookOpen,
  Play,
  Sparkles,
} from "lucide-react";
import { RainbowButton } from "@/components/ui/rainbow-button";

type PythonPm = "pip" | "uv" | "poetry";
type TsPm = "npm" | "pnpm" | "yarn" | "bun";

export default function CreatorPage() {
  const [copiedAgentPrompt, setCopiedAgentPrompt] = useState(false);
  const [copiedPythonCmd, setCopiedPythonCmd] = useState(false);
  const [copiedTsCmd, setCopiedTsCmd] = useState(false);
  const [copiedPythonCode, setCopiedPythonCode] = useState(false);
  const [copiedTsCode, setCopiedTsCode] = useState(false);

  const [selectedPythonPm, setSelectedPythonPm] = useState<PythonPm>("pip");
  const [selectedTsPm, setSelectedTsPm] = useState<TsPm>("npm");

  const [pythonDropdownOpen, setPythonDropdownOpen] = useState(false);
  const [tsDropdownOpen, setTsDropdownOpen] = useState(false);

  const pythonDropdownRef = useRef<HTMLDivElement>(null);
  const tsDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        pythonDropdownRef.current &&
        !pythonDropdownRef.current.contains(event.target as Node)
      ) {
        setPythonDropdownOpen(false);
      }
      if (
        tsDropdownRef.current &&
        !tsDropdownRef.current.contains(event.target as Node)
      ) {
        setTsDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const agentPrompt = `You are an expert AI agent developer using the Catelog SDK.
Create a production-ready AI agent with the following requirements:
1. Initialize CatelogClient with your API credentials.
2. Register the agent with name, description, framework, tags, and pricing model.
3. Configure tools, memory store, and execution handlers.
4. Add robust validation, telemetry, and error handling.
5. Publish the agent to the Catelog Marketplace.`;

  const pythonCommands: Record<PythonPm, { label: string; cmd: string }> = {
    pip: { label: "pip", cmd: "pip install catelog" },
    uv: { label: "uv", cmd: "uv add catelog" },
    poetry: { label: "poetry", cmd: "poetry add catelog" },
  };

  const tsCommands: Record<TsPm, { label: string; cmd: string }> = {
    npm: { label: "npm", cmd: "npm install @catelog/sdk" },
    pnpm: { label: "pnpm", cmd: "pnpm add @catelog/sdk" },
    yarn: { label: "yarn", cmd: "yarn add @catelog/sdk" },
    bun: { label: "bun", cmd: "bun add @catelog/sdk" },
  };

  const renderPythonPmLogo = (pm: PythonPm) => {
    switch (pm) {
      case "pip":
        return (
          <svg viewBox="0 0 24 24" className="size-3.5 shrink-0" fill="none">
            <rect width="24" height="24" rx="4" fill="#3775A9" />
            <path
              d="M6 7h12M6 12h8M6 17h10"
              stroke="#FFF"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
        );
      case "uv":
        return (
          <Image
            src="/uv.svg"
            alt="uv"
            width={14}
            height={14}
            className="size-3.5 shrink-0 object-contain"
          />
        );
      case "poetry":
        return (
          <Image
            src="/poetry.svg"
            alt="poetry"
            width={14}
            height={14}
            className="size-3.5 shrink-0 object-contain"
          />
        );
    }
  };

  const renderTsPmLogo = (pm: TsPm) => {
    switch (pm) {
      case "npm":
        return (
          <Image
            src="/npm.svg"
            alt="npm"
            width={14}
            height={14}
            className="size-3.5 shrink-0 object-contain"
          />
        );
      case "pnpm":
        return (
          <Image
            src="/pnpm.svg"
            alt="pnpm"
            width={14}
            height={14}
            className="size-3.5 shrink-0 object-contain"
          />
        );
      case "yarn":
        return (
          <Image
            src="/yarn.svg"
            alt="yarn"
            width={14}
            height={14}
            className="size-3.5 shrink-0 object-contain"
          />
        );
      case "bun":
        return (
          <Image
            src="/bun.svg"
            alt="bun"
            width={14}
            height={14}
            className="size-3.5 shrink-0 object-contain"
          />
        );
    }
  };

  const pythonCode = `from catelog import CatelogClient

client = CatelogClient(api_key="YOUR_API_KEY")

client.register_agent(
    name="my-agent",
    description="Research agent for web and docs",
    framework="langgraph",
)`;

  const tsCode = `import { CatelogClient } from "@catelog/sdk";

const client = new CatelogClient({
  apiKey: "YOUR_API_KEY",
});

await client.registerAgent({
  name: "my-agent",
  description: "Research agent for web and docs",
  framework: "langgraph",
});`;

  const copyToClipboard = (
    text: string,
    setCopied: React.Dispatch<React.SetStateAction<boolean>>,
  ) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const frameworks = [
    {
      name: "LangGraph",
      src: "/langgraph.svg",
      className: "h-5 w-auto dark:invert brightness-100",
    },
    {
      name: "CrewAI",
      src: "/crewai.svg",
      className: "h-5 w-auto",
    },
    {
      name: "OpenAI SDK",
      src: "/openai.svg",
      className: "h-5 w-auto invert dark:invert-0",
    },
    {
      name: "LangChain",
      src: "/langchain-color.svg",
      className: "h-5 w-auto",
    },
    {
      name: "Anthropic",
      src: "/anthropic.svg",
      className: "h-5 w-auto invert dark:invert-0",
    },
    {
      name: "Google ADK",
      src: "/google.svg",
      className: "h-5 w-auto",
    },
    {
      name: "LlamaIndex",
      src: "/llamaindex.svg",
      className: "h-5 w-auto text-foreground fill-current",
    },
    {
      name: "Pydantic AI",
      src: "/pydantic.svg",
      className: "h-5 w-auto",
    },
    {
      name: "Mastra",
      src: "/mastra.svg",
      className: "h-5 w-auto dark:invert",
    },
    {
      name: "Vercel",
      src: "/vercel-wordmark.svg",
      className: "h-3.5 w-auto invert dark:invert-0",
    },
  ];

  return (
    <div className="flex-1 h-full overflow-y-auto scrollbar-thin p-6 lg:p-8 space-y-8 bg-white dark:bg-neutral-950">
      {/* Top Header Section */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 pb-2">
        <div className="max-w-xl">
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground mt-0.5">
            Creator Space
          </h1>
          <p className="text-sm sm:text-base font-semibold text-neutral-800 dark:text-neutral-200 mt-1">
            Build. Publish. Monetize your AI agents.
          </p>
          <p className="text-xs sm:text-sm text-muted-foreground mt-1.5 leading-relaxed">
            Use our SDK to register your agent, manage metadata, set pricing and
            publish it to the Catelog marketplace. Compatible with 10+ agent
            frameworks.
          </p>
        </div>

        {/* Action buttons */}
        <div className="flex flex-col gap-2.5 shrink-0">
          <div className="flex items-center gap-2">
            <Link
              href="/space/creator"
              className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-md text-xs font-medium bg-neutral-900 text-white hover:bg-black dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-100 shadow-xs transition-all cursor-pointer"
            >
              <Upload className="size-3.5" />
              <span>Publish an agent</span>
            </Link>
            <button
              type="button"
              onClick={() => {
                const el = document.getElementById("dev-credentials");
                el?.scrollIntoView({ behavior: "smooth" });
              }}
              className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-md text-xs font-medium bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 text-foreground hover:bg-neutral-50 dark:hover:bg-neutral-800/80 shadow-2xs transition-all cursor-pointer"
            >
              <Key className="size-3.5" />
              <span>Get API key</span>
            </button>
          </div>
        </div>
      </div>

      {/* Catelog SDK Section */}
      <div id="sdk" className="space-y-4 pt-2">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
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
            {/* Copy Agent Prompt button with RainbowButton */}
            <RainbowButton
              type="button"
              size="sm"
              onClick={() => copyToClipboard(agentPrompt, setCopiedAgentPrompt)}
              title="Copy Agent System Prompt"
              className="h-9 rounded-md px-3.5 text-xs font-medium gap-1.5 shadow-sm hover:scale-[1.02] active:scale-[0.98] transition-all cursor-pointer"
            >
              <span>
                {copiedAgentPrompt ? "Prompt Copied!" : "Copy Agent Prompt"}
              </span>
              {copiedAgentPrompt ? (
                <Check className="size-3.5 text-emerald-400" />
              ) : (
                <Copy className="size-3.5 opacity-80" />
              )}
            </RainbowButton>

            <a
              href="https://github.com"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md text-xs font-medium border border-neutral-200 dark:border-neutral-800 bg-white dark:hover:bg-neutral-900 text-foreground transition-colors cursor-pointer"
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

        {/* 3-Column Grid: Python Code, TS Code, Feature Box */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          {/* Python SDK Box */}
          <div className="lg:col-span-5 flex flex-col rounded-xl border border-neutral-200/90 dark:border-neutral-800 bg-[#0d1117] text-white shadow-2xs overflow-hidden">
            <div className="flex items-center justify-between px-3.5 py-2.5 border-b border-neutral-800/80 bg-[#161b22]">
              <div className="flex items-center gap-2">
                <Image
                  src="/python.png"
                  alt="Python"
                  width={18}
                  height={18}
                  className="rounded-xs"
                />
                <span className="text-xs font-semibold text-neutral-200">
                  Python
                </span>
              </div>

              {/* Package manager dropdown & copy */}
              <div
                className="relative flex items-center"
                ref={pythonDropdownRef}
              >
                <div className="flex items-center rounded-md border border-neutral-700/80 bg-neutral-900/90 hover:border-neutral-600 transition-colors">
                  <button
                    type="button"
                    onClick={() => setPythonDropdownOpen(!pythonDropdownOpen)}
                    className="flex items-center gap-1.5 px-2 py-1 text-neutral-300 hover:text-white transition-colors cursor-pointer"
                    title="Select package manager"
                  >
                    {renderPythonPmLogo(selectedPythonPm)}
                    <span className="text-[11px] font-mono font-medium">
                      {selectedPythonPm}
                    </span>
                    <ChevronDown className="size-3 text-neutral-400" />
                  </button>

                  <div className="h-3.5 w-px bg-neutral-700/80" />

                  <button
                    type="button"
                    onClick={() =>
                      copyToClipboard(
                        pythonCommands[selectedPythonPm].cmd,
                        setCopiedPythonCmd,
                      )
                    }
                    title={`Copy: ${pythonCommands[selectedPythonPm].cmd}`}
                    className="p-1 px-1.5 text-neutral-400 hover:text-white hover:bg-neutral-800/60 rounded-r-md transition-colors cursor-pointer"
                  >
                    {copiedPythonCmd ? (
                      <Check className="size-3 text-emerald-400" />
                    ) : (
                      <Copy className="size-3" />
                    )}
                  </button>
                </div>

                {/* Dropdown menu */}
                {pythonDropdownOpen && (
                  <div className="absolute right-0 top-full mt-1.5 w-36 rounded-lg bg-[#161b22] border border-neutral-700 shadow-xl p-1 z-30 flex flex-col gap-0.5 animate-in fade-in-0 zoom-in-95">
                    {(["pip", "uv", "poetry"] as PythonPm[]).map((pm) => (
                      <button
                        key={pm}
                        type="button"
                        onClick={() => {
                          setSelectedPythonPm(pm);
                          setPythonDropdownOpen(false);
                        }}
                        className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded text-xs transition-colors cursor-pointer ${
                          selectedPythonPm === pm
                            ? "bg-neutral-800 text-white font-medium"
                            : "text-neutral-400 hover:text-white hover:bg-neutral-800/60"
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          {renderPythonPmLogo(pm)}
                          <span className="font-mono">{pm}</span>
                        </div>
                        {selectedPythonPm === pm && (
                          <Check className="size-3 text-emerald-400" />
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="relative p-3.5 font-mono text-xs leading-relaxed overflow-x-auto flex-1">
              <button
                type="button"
                onClick={() => copyToClipboard(pythonCode, setCopiedPythonCode)}
                title="Copy code"
                className="absolute top-2.5 right-2.5 p-1 rounded bg-neutral-800/80 text-neutral-400 hover:text-white transition-colors cursor-pointer"
              >
                {copiedPythonCode ? (
                  <Check className="size-3 text-emerald-400" />
                ) : (
                  <Copy className="size-3" />
                )}
              </button>
              <pre className="text-neutral-300">
                <code>
                  <span className="text-purple-400">from</span> catelog{" "}
                  <span className="text-purple-400">import</span> CatelogClient
                  {"\n\n"}
                  client = CatelogClient(api_key=
                  <span className="text-emerald-400">"YOUR_API_KEY"</span>)
                  {"\n\n"}
                  client.register_agent({"\n"}
                  {"    "}name=
                  <span className="text-emerald-400">"my-agent"</span>,{"\n"}
                  {"    "}description=
                  <span className="text-emerald-400">
                    "Research agent for web and docs"
                  </span>
                  ,{"\n"}
                  {"    "}framework=
                  <span className="text-emerald-400">"langgraph"</span>,{"\n"}
                  {"    "}price_per_run=
                  <span className="text-amber-300">0.05</span>,{"\n"}
                  {"    "}currency=
                  <span className="text-emerald-400">"USD"</span>,{"\n"}
                  {"    "}tags=[
                  <span className="text-emerald-400">"research"</span>,{" "}
                  <span className="text-emerald-400">"langgraph"</span>],{"\n"})
                </code>
              </pre>
            </div>
          </div>

          {/* TypeScript SDK Box */}
          <div className="lg:col-span-4 flex flex-col rounded-xl border border-neutral-200/90 dark:border-neutral-800 bg-[#0d1117] text-white shadow-2xs overflow-hidden">
            <div className="flex items-center justify-between px-3.5 py-2.5 border-b border-neutral-800/80 bg-[#161b22]">
              <div className="flex items-center gap-2">
                <Image
                  src="/typescript.png"
                  alt="TypeScript"
                  width={18}
                  height={18}
                  className="rounded-xs"
                />
                <span className="text-xs font-semibold text-neutral-200">
                  TypeScript
                </span>
              </div>

              {/* Package manager dropdown & copy */}
              <div
                className="relative flex items-center"
                ref={tsDropdownRef}
              >
                <div className="flex items-center rounded-md border border-neutral-700/80 bg-neutral-900/90 hover:border-neutral-600 transition-colors">
                  <button
                    type="button"
                    onClick={() => setTsDropdownOpen(!tsDropdownOpen)}
                    className="flex items-center gap-1.5 px-2 py-1 text-neutral-300 hover:text-white transition-colors cursor-pointer"
                    title="Select package manager"
                  >
                    {renderTsPmLogo(selectedTsPm)}
                    <span className="text-[11px] font-mono font-medium">
                      {selectedTsPm}
                    </span>
                    <ChevronDown className="size-3 text-neutral-400" />
                  </button>

                  <div className="h-3.5 w-px bg-neutral-700/80" />

                  <button
                    type="button"
                    onClick={() =>
                      copyToClipboard(
                        tsCommands[selectedTsPm].cmd,
                        setCopiedTsCmd,
                      )
                    }
                    title={`Copy: ${tsCommands[selectedTsPm].cmd}`}
                    className="p-1 px-1.5 text-neutral-400 hover:text-white hover:bg-neutral-800/60 rounded-r-md transition-colors cursor-pointer"
                  >
                    {copiedTsCmd ? (
                      <Check className="size-3 text-emerald-400" />
                    ) : (
                      <Copy className="size-3" />
                    )}
                  </button>
                </div>

                {/* Dropdown menu */}
                {tsDropdownOpen && (
                  <div className="absolute right-0 top-full mt-1.5 w-36 rounded-lg bg-[#161b22] border border-neutral-700 shadow-xl p-1 z-30 flex flex-col gap-0.5 animate-in fade-in-0 zoom-in-95">
                    {(["npm", "pnpm", "yarn", "bun"] as TsPm[]).map((pm) => (
                      <button
                        key={pm}
                        type="button"
                        onClick={() => {
                          setSelectedTsPm(pm);
                          setTsDropdownOpen(false);
                        }}
                        className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded text-xs transition-colors cursor-pointer ${
                          selectedTsPm === pm
                            ? "bg-neutral-800 text-white font-medium"
                            : "text-neutral-400 hover:text-white hover:bg-neutral-800/60"
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          {renderTsPmLogo(pm)}
                          <span className="font-mono">{pm}</span>
                        </div>
                        {selectedTsPm === pm && (
                          <Check className="size-3 text-emerald-400" />
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="relative p-3.5 font-mono text-xs leading-relaxed overflow-x-auto flex-1">
              <button
                type="button"
                onClick={() => copyToClipboard(tsCode, setCopiedTsCode)}
                title="Copy code"
                className="absolute top-2.5 right-2.5 p-1 rounded bg-neutral-800/80 text-neutral-400 hover:text-white transition-colors cursor-pointer"
              >
                {copiedTsCode ? (
                  <Check className="size-3 text-emerald-400" />
                ) : (
                  <Copy className="size-3" />
                )}
              </button>
              <pre className="text-neutral-300">
                <code>
                  <span className="text-purple-400">import</span> &#123;{" "}
                  CatelogClient &#125;{" "}
                  <span className="text-purple-400">from</span>{" "}
                  <span className="text-emerald-400">"@catelog/sdk"</span>;
                  {"\n\n"}
                  <span className="text-blue-400">const</span> client ={" "}
                  <span className="text-purple-400">new</span> CatelogClient(
                  &#123;
                  {"\n"}
                  {"  "}apiKey:{" "}
                  <span className="text-emerald-400">"YOUR_API_KEY"</span>,
                  {"\n"}
                  &#125;);{"\n\n"}
                  <span className="text-purple-400">await</span>{" "}
                  client.registerAgent(&#123;{"\n"}
                  {"  "}name:{" "}
                  <span className="text-emerald-400">"my-agent"</span>,{"\n"}
                  {"  "}description:{" "}
                  <span className="text-emerald-400">
                    "Research agent for web and docs"
                  </span>
                  ,{"\n"}
                  {"  "}framework:{" "}
                  <span className="text-emerald-400">"langgraph"</span>,{"\n"}
                  {"  "}pricePerRun:{" "}
                  <span className="text-amber-300">0.05</span>,{"\n"}
                  {"  "}currency:{" "}
                  <span className="text-emerald-400">"USD"</span>,{"\n"}
                  {"  "}tags: [
                  <span className="text-emerald-400">"research"</span>,{" "}
                  <span className="text-emerald-400">"langgraph"</span>],{"\n"}
                  &#125;);
                </code>
              </pre>
            </div>
          </div>

          {/* Right side small box: Docs link, Demo & Key Features */}
          <div className="lg:col-span-3 flex flex-col justify-between rounded-xl border border-neutral-200/90 dark:border-neutral-800 bg-neutral-50/50 dark:bg-neutral-900/40 p-4 shadow-2xs">
            <div className="space-y-3.5">
              <div className="flex items-start gap-2.5">
                <Box className="size-4 text-neutral-600 dark:text-neutral-300 shrink-0 mt-0.5" />
                <div className="leading-tight">
                  <p className="text-xs font-semibold text-foreground">
                    Simple and consistent API
                  </p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    Same interface across frameworks
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-2.5">
                <SlidersHorizontal className="size-4 text-neutral-600 dark:text-neutral-300 shrink-0 mt-0.5" />
                <div className="leading-tight">
                  <p className="text-xs font-semibold text-foreground">
                    Register & manage agents
                  </p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    Configure metadata, tools, pricing
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-2.5">
                <Server className="size-4 text-neutral-600 dark:text-neutral-300 shrink-0 mt-0.5" />
                <div className="leading-tight">
                  <p className="text-xs font-semibold text-foreground">
                    Bring your own server (BYOS)
                  </p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    Host anywhere or use our hosting (soon)
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-2.5">
                <ShieldCheck className="size-4 text-neutral-600 dark:text-neutral-300 shrink-0 mt-0.5" />
                <div className="leading-tight">
                  <p className="text-xs font-semibold text-foreground">
                    Secure and production ready
                  </p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    API keys, rate limits, usage tracking
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-2.5">
                <FileText className="size-4 text-neutral-600 dark:text-neutral-300 shrink-0 mt-0.5" />
                <div className="leading-tight">
                  <p className="text-xs font-semibold text-foreground">
                    Detailed documentation
                  </p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    Guides, examples and best practices
                  </p>
                </div>
              </div>
            </div>

            {/* Docs link & Demo button */}
            <div className="pt-4 border-t border-neutral-200/80 dark:border-neutral-800/80 flex flex-col gap-2 mt-2">
              <Link
                href="/docs"
                className="w-full inline-flex items-center justify-between px-3 py-1.5 rounded-lg text-xs font-medium bg-neutral-900 text-white hover:bg-black dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-100 transition-all cursor-pointer"
              >
                <span>Read documentation</span>
                <ArrowRight className="size-3.5" />
              </Link>
              <button
                type="button"
                onClick={() => {
                  alert("Interactive SDK playground & demo sandbox loading...");
                }}
                className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-neutral-200 dark:border-neutral-800 hover:bg-neutral-100 dark:hover:bg-neutral-800 text-foreground transition-all cursor-pointer"
              >
                <Play className="size-3 fill-current" />
                <span>Try quick demo</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Publish your agent in 3 steps */}
      <div className="space-y-3.5 pt-2">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-foreground">
              Publish your agent in 3 steps
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Go from idea to marketplace in minutes.
            </p>
          </div>
          <Link
            href="/docs"
            className="text-xs text-blue-600 dark:text-blue-400 hover:underline inline-flex items-center gap-1 font-medium cursor-pointer"
          >
            <span>View detailed guide</span>
            <ArrowRight className="size-3" />
          </Link>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 p-4 rounded-xl border border-neutral-200/80 dark:border-neutral-800 bg-neutral-50/40 dark:bg-neutral-900/20">
          {/* Step 1 */}
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-start gap-3 min-w-0">
              <div className="size-5 rounded-full bg-blue-500/15 text-blue-600 dark:text-blue-400 font-bold text-xs flex items-center justify-center shrink-0 mt-0.5">
                1
              </div>
              <div className="size-8 rounded-lg bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 flex items-center justify-center shrink-0 shadow-2xs">
                <Code2 className="size-4 text-foreground" />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-semibold text-foreground">
                  Install SDK
                </p>
                <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">
                  Install the SDK for Python or TypeScript and configure your
                  API key.
                </p>
              </div>
            </div>
            <ChevronRight className="hidden md:block size-4 text-neutral-400 dark:text-neutral-600 shrink-0" />
          </div>

          {/* Step 2 */}
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-start gap-3 min-w-0">
              <div className="size-5 rounded-full bg-blue-500/15 text-blue-600 dark:text-blue-400 font-bold text-xs flex items-center justify-center shrink-0 mt-0.5">
                2
              </div>
              <div className="size-8 rounded-lg bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 flex items-center justify-center shrink-0 shadow-2xs">
                <FileText className="size-4 text-foreground" />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-semibold text-foreground">
                  Register your agent
                </p>
                <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">
                  Define metadata, tools, pricing and framework. Use a few lines
                  of code.
                </p>
              </div>
            </div>
            <ChevronRight className="hidden md:block size-4 text-neutral-400 dark:text-neutral-600 shrink-0" />
          </div>

          {/* Step 3 */}
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-start gap-3 min-w-0">
              <div className="size-5 rounded-full bg-blue-500/15 text-blue-600 dark:text-blue-400 font-bold text-xs flex items-center justify-center shrink-0 mt-0.5">
                3
              </div>
              <div className="size-8 rounded-lg bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 flex items-center justify-center shrink-0 shadow-2xs">
                <Rocket className="size-4 text-foreground" />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-semibold text-foreground">Publish</p>
                <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">
                  Validate your agent and publish to the Catelog marketplace.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Works with 10+ agent frameworks */}
      <div className="space-y-3.5 pt-2">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-foreground">
              Works with 10+ agent frameworks
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Use Catelog SDK with your existing stack. Framework agnostic.
            </p>
          </div>
          <Link
            href="/docs"
            className="text-xs text-blue-600 dark:text-blue-400 hover:underline inline-flex items-center gap-1 font-medium cursor-pointer"
          >
            <span>View all integrations</span>
            <ArrowRight className="size-3" />
          </Link>
        </div>

        {/* 10 Available Framework SVGs in public */}
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
          {frameworks.map((fw) => (
            <div
              key={fw.name}
              className="flex flex-col items-center justify-center p-3.5 rounded-xl border border-neutral-200/80 dark:border-neutral-800/80 bg-white dark:bg-neutral-900/60 hover:bg-neutral-50 dark:hover:bg-neutral-800/70 hover:border-neutral-300 dark:hover:border-neutral-700 transition-all shadow-2xs gap-2.5 group cursor-pointer"
            >
              <div className="h-6 flex items-center justify-center">
                <Image
                  src={fw.src}
                  alt={fw.name}
                  width={22}
                  height={22}
                  className={fw.className}
                />
              </div>
              <span className="text-xs font-medium text-foreground text-center truncate w-full">
                {fw.name}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Bottom 2 Cards: Documentation & Developer credentials */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
        {/* Card 1: Documentation */}
        <div className="flex items-start justify-between gap-4 p-4 rounded-xl border border-neutral-200/80 dark:border-neutral-800 bg-white dark:bg-neutral-900/40 shadow-2xs">
          <div className="flex items-start gap-3">
            <div className="p-2.5 rounded-lg bg-neutral-100 dark:bg-neutral-800 text-foreground shrink-0">
              <BookOpen className="size-5" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-foreground">
                Documentation
              </h3>
              <p className="text-xs text-muted-foreground mt-1 leading-snug">
                Installation guides, API reference, examples, and framework
                specific tutorials.
              </p>
              <Link
                href="/docs"
                className="inline-flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 hover:underline font-medium mt-2 cursor-pointer"
              >
                <span>Read full documentation</span>
                <ArrowRight className="size-3" />
              </Link>
            </div>
          </div>
        </div>

        {/* Card 2: Developer credentials */}
        <div
          id="dev-credentials"
          className="flex items-start justify-between gap-4 p-4 rounded-xl border border-neutral-200/80 dark:border-neutral-800 bg-white dark:bg-neutral-900/40 shadow-2xs"
        >
          <div className="flex items-start gap-3">
            <div className="p-2.5 rounded-lg bg-neutral-100 dark:bg-neutral-800 text-foreground shrink-0">
              <Key className="size-5" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-foreground">
                Developer credentials
              </h3>
              <p className="text-xs text-muted-foreground mt-1 leading-snug">
                Create and manage API keys for SDK authentication.
              </p>
            </div>
          </div>
          <Link
            href="/space/creator"
            className="shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 hover:bg-neutral-50 dark:hover:bg-neutral-800 text-foreground shadow-2xs transition-colors cursor-pointer"
          >
            Manage API keys
          </Link>
        </div>
      </div>
    </div>
  );
}
