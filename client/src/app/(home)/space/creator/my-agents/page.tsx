"use client";

import React, { useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  BookOpen,
  Key,
  Lock,
  Server,
  ShieldCheck,
  ScanSearch,
  FileSignature,
  BookAlert,
} from "lucide-react";
import { RegisterAgentDialog } from "@/modules/space/components/register-agent-dialog";
import { Button } from "@/components/ui/button";
import { CardDitherBackground } from "@/components/ui/card-dither-background";

const trust = [
  {
    icon: Server,
    title: "Your server, your code",
    description:
      "Agents run on infrastructure you control. We never host, copy or see your source code or model keys.",
  },
  {
    icon: Lock,
    title: "Authenticated calls",
    description:
      "Every execution request is authenticated with your Catelog secret key, so only the marketplace can invoke your agent.",
  },
  {
    icon: ScanSearch,
    title: "Read-only registration",
    description:
      "During registration we only read /health and /schema. Nothing is executed and nothing is stored beyond the manifest.",
  },
  {
    icon: ShieldCheck,
    title: "Protected for buyers and creators",
    description:
      "Inputs are validated against your schema before they reach you, with rate limits and usage tracking on every call.",
  },
];

const steps = [
  { title: "Register your agent", note: "Connect your server URL" },
  { title: "Configure", note: "Review details and set pricing" },
  { title: "Publish", note: "Go live on the marketplace" },
];

export default function MyAgentsPage() {
  const [open, setOpen] = useState(false);

  return (
    <div className="flex-1 h-full overflow-y-auto scrollbar-thin px-10 py-8 bg-background">
      <div className="max-w-7xl mx-auto space-y-10">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-foreground">
            Ready to Turn your AI agents into recurring revenue?
          </h1>
          <p className="text-sm text-muted-foreground mt-2 max-w-2xl leading-relaxed">
            Bring your own server (BYOS) with zero code lock-in. Connect your
            Catelog SDK endpoint, register in Catelog Marketplace, and start
            monetizing calls from developers worldwide in minutes.
          </p>
        </div>

        {/* Pre-flight note */}
        <div className="flex items-start gap-3 rounded-lg border border-zinc-200 dark:border-neutral-800 p-4 shadow-2xs">
          <div className="size-8 rounded-md border border-zinc-300 dark:border-zinc-700 bg-background/90 flex items-center justify-center shrink-0 shadow-2xs">
            <Key className="size-4 text-foreground" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-foreground">
              Before you start
            </p>
            <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
              Ensure your server has the Catelog SDK running and an active API
              secret key. Ready to connect? Or check the quickstart guide.
            </p>
            <div className="mt-3">
              <Link href="/docs">
                <Button size="sm" className="text-xs gap-1.5 cursor-pointer">
                  <span>View docs</span>
                  <BookAlert className="size-3.5" />
                </Button>
              </Link>
            </div>
          </div>
        </div>

        {/* Trust */}
        <section className="space-y-4">
          <h2 className="text-sm font-semibold text-foreground">
            Secure by design
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-4xl mx-auto">
            {trust.map((t) => (
              <div
                key={t.title}
                className="relative overflow-hidden p-4.5 bg-white dark:bg-card rounded-lg border border-zinc-300 dark:border-zinc-800 shadow-2xs transition-all duration-200"
              >
                {/* Dither pixel animation at bottom-right end */}
                <div className="absolute -bottom-2 -right-2 w-60 h-36 pointer-events-none overflow-hidden [mask-image:radial-gradient(ellipse_at_bottom_right,black_35%,transparent_75%)] opacity-100 ">
                  <CardDitherBackground />
                </div>

                <div className="relative z-10">
                  <div className="size-8 rounded-md border border-zinc-300 dark:border-zinc-700 bg-background/90 shadow-2xs flex items-center justify-center">
                    <t.icon className="size-4 text-foreground" />
                  </div>
                  <p className="text-xs font-semibold text-foreground mt-3">
                    {t.title}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                    {t.description}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Steps: Horizontal Pipeline with Equal Height Boxes */}
        <section className="space-y-4">
          <style>{`
            @keyframes stepDashAnim {
              from { stroke-dashoffset: 14; }
              to { stroke-dashoffset: 0; }
            }
            .animate-step-line {
              stroke-dasharray: 4 3;
              animation: stepDashAnim 1s linear infinite;
            }
          `}</style>

          <h2 className="text-sm font-semibold text-foreground">
            How publishing works
          </h2>

          <div className="flex flex-col lg:flex-row items-stretch">
            {/* Step 1 */}
            <div className="flex-1 bg-white dark:bg-card rounded-lg border border-zinc-300 dark:border-zinc-800 p-4 shadow-2xs flex flex-col justify-between min-h-[160px]">
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <span className="size-6 rounded-full flex items-center justify-center text-[11px] font-mono font-medium bg-foreground text-background shrink-0 shadow-2xs">
                    1
                  </span>
                  <p className="text-xs font-semibold text-foreground">
                    Register agent
                  </p>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Connect your public server URL
                </p>
              </div>
              <div className="mt-3">
                <button
                  type="button"
                  onClick={() => setOpen(true)}
                  className="w-full inline-flex items-center justify-center gap-1.5 h-8 px-3 rounded-md text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors cursor-pointer"
                >
                  <span>Register agent</span>
                  <ArrowRight className="size-3.5" />
                </button>
              </div>
            </div>

            {/* SVG Connector 1 -> 2 (End-to-End with Dot) */}
            <div className="hidden lg:flex items-center justify-center shrink-0 w-8 xl:w-12 self-center text-zinc-400 dark:text-zinc-600">
              <svg
                className="w-full h-4 overflow-visible"
                viewBox="0 0 48 16"
                fill="none"
              >
                <line
                  x1="0"
                  y1="8"
                  x2="48"
                  y2="8"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  className="animate-step-line"
                />
                <circle
                  cx="24"
                  cy="8"
                  r="3"
                  className="fill-foreground text-foreground"
                />
              </svg>
            </div>

            {/* Step 2 */}
            <div className="flex-1 bg-white dark:bg-card rounded-lg border border-zinc-300 dark:border-zinc-800 p-4 shadow-2xs flex flex-col justify-between min-h-[160px]">
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <span className="size-6 rounded-full flex items-center justify-center text-[11px] font-mono font-medium border border-zinc-300 dark:border-zinc-700 text-muted-foreground bg-background/80 shrink-0">
                    2
                  </span>
                  <p className="text-xs font-semibold text-foreground">
                    Configure
                  </p>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Review schema details & set per-call pricing
                </p>
              </div>
              <p className="text-[11px] text-muted-foreground/80 mt-3 pt-2 border-t border-border/40">
                Step 2
              </p>
            </div>

            {/* SVG Connector 2 -> 3 (End-to-End with Dot) */}
            <div className="hidden lg:flex items-center justify-center shrink-0 w-8 xl:w-12 self-center text-zinc-400 dark:text-zinc-600">
              <svg
                className="w-full h-4 overflow-visible"
                viewBox="0 0 48 16"
                fill="none"
              >
                <line
                  x1="0"
                  y1="8"
                  x2="48"
                  y2="8"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  className="animate-step-line"
                />
                <circle
                  cx="24"
                  cy="8"
                  r="3"
                  className="fill-foreground text-foreground"
                />
              </svg>
            </div>

            {/* Step 3 */}
            <div className="flex-1 bg-white dark:bg-card rounded-lg border border-zinc-300 dark:border-zinc-800 p-4 shadow-2xs flex flex-col justify-between min-h-[160px]">
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <span className="size-6 rounded-full flex items-center justify-center text-[11px] font-mono font-medium border border-zinc-300 dark:border-zinc-700 text-muted-foreground bg-background/80 shrink-0">
                    3
                  </span>
                  <p className="text-xs font-semibold text-foreground">
                    Publish
                  </p>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Go live directly on the Catelog marketplace
                </p>
              </div>
              <p className="text-[11px] text-muted-foreground/80 mt-3 pt-2 border-t border-border/40">
                Step 3
              </p>
            </div>

            {/* SVG Connector 3 -> 4 (End-to-End with Dot) */}
            <div className="hidden lg:flex items-center justify-center shrink-0 w-8 xl:w-12 self-center text-zinc-400 dark:text-zinc-600">
              <svg
                className="w-full h-4 overflow-visible"
                viewBox="0 0 48 16"
                fill="none"
              >
                <line
                  x1="0"
                  y1="8"
                  x2="48"
                  y2="8"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  className="animate-step-line"
                />
                <circle
                  cx="24"
                  cy="8"
                  r="3"
                  className="fill-foreground text-foreground"
                />
              </svg>
            </div>

            {/* Step 4: Contract */}
            <div className="flex-1 bg-white dark:bg-card rounded-lg border border-zinc-300 dark:border-zinc-800 p-4 shadow-2xs flex flex-col justify-between min-h-[160px]">
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <span className="size-6 rounded-full flex items-center justify-center text-[11px] font-mono font-medium border border-zinc-300 dark:border-zinc-700 text-muted-foreground bg-background/80 shrink-0">
                    <FileSignature className="size-3.5" />
                  </span>
                  <p className="text-xs font-semibold text-foreground">
                    Sign Contract
                  </p>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Sign the Legal Notice and marketplace contract for Trust and
                  Safety.
                </p>
              </div>
              <p className="text-[11px] text-muted-foreground/80 mt-3 pt-2 border-t border-border/40">
                Notice
              </p>
            </div>
          </div>
        </section>
      </div>

      <RegisterAgentDialog open={open} onOpenChange={setOpen} />
    </div>
  );
}
