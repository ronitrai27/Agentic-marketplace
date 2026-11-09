"use client";

import React, { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  Code2,
  Workflow,
  Check,
  ArrowRight,
  BookOpen,
  type LucideIcon,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { RegisterAgentDialog } from "./register-agent-dialog";
import { NoCodeRegisterFlow } from "./no-code/no-code-register-flow";

type Path = "sdk" | "nocode";

interface Logo {
  name: string;
  src: string;
  className?: string;
  soon?: boolean;
}

const SDK_LOGOS: Logo[] = [
  { name: "LangGraph", src: "/langgraph.svg", className: "dark:invert" },
  { name: "Google ADK", src: "/google.svg" },
  {
    name: "Claude SDK",
    src: "/anthropic.svg",
    className: "invert dark:invert-0",
  },
];

const NOCODE_LOGOS: Logo[] = [
  { name: "n8n", src: "/n8n-color.svg" },
  { name: "Dify", src: "/dify-color.png", soon: true },
  {
    name: "Langflow",
    src: "/langflow.png",
    className: "dark:invert",
    soon: true,
  },
  { name: "Flowise", src: "/flowise-seeklogo.svg", soon: true },
];

function LogoChip({ logo }: { logo: Logo }) {
  return (
    <span
      title={logo.soon ? `${logo.name}: coming soon` : logo.name}
      className={`relative flex size-9 items-center justify-center rounded-md border border-border bg-background shadow-2xs ${
        logo.soon ? "opacity-45 grayscale" : ""
      }`}
    >
      <Image
        src={logo.src}
        alt={logo.name}
        width={20}
        height={20}
        className={`h-5 w-auto max-w-6 ${logo.className ?? ""}`}
      />
    </span>
  );
}

function PathCard({
  selected,
  onSelect,
  icon: Icon,
  title,
  badge,
  body,
  logos,
  moreText,
  footnote,
}: {
  selected: boolean;
  onSelect: () => void;
  icon: LucideIcon;
  title: string;
  badge: string;
  body: string;
  logos: Logo[];
  moreText?: string;
  footnote?: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={`group relative flex flex-col gap-4 rounded-xl border p-5 text-left transition-all cursor-pointer ${
        selected
          ? "border-foreground bg-card shadow-md ring-4 ring-foreground/5"
          : "border-border bg-card shadow-2xs hover:-translate-y-0.5 hover:border-foreground/30 hover:shadow-sm"
      }`}
    >
      <span
        className={`absolute right-4 top-4 flex size-5 items-center justify-center rounded-full border transition-colors ${
          selected
            ? "border-foreground bg-foreground text-background"
            : "border-border bg-background"
        }`}
      >
        {selected && <Check className="size-3" />}
      </span>

      <span className="flex size-10 items-center justify-center rounded-lg bg-foreground text-background shadow-sm">
        <Icon className="size-5" />
      </span>

      <div className="space-y-1.5 pr-6">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-base font-semibold text-foreground">{title}</h3>
          <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            {badge}
          </span>
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">{body}</p>
      </div>

      <div className="mt-auto space-y-2 border-t border-border/70 pt-4">
        <div className="flex flex-wrap items-center gap-1.5">
          {logos.map((l) => (
            <LogoChip key={l.name} logo={l} />
          ))}
          {moreText && (
            <span className="inline-flex h-9 items-center justify-center rounded-md border border-border bg-background px-2.5 text-xs font-medium text-muted-foreground shadow-2xs">
              {moreText}
            </span>
          )}
        </div>
        {footnote && (
          <p className="text-[11px] text-muted-foreground">{footnote}</p>
        )}
      </div>
    </button>
  );
}

/**
 * Entry point for "Register agent": a welcome screen to pick the SDK (code-first) path or the
 * no-code path. The SDK path opens the existing register dialog unchanged.
 */
export function AgentOnboardingDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [path, setPath] = useState<Path | null>(null);
  const [view, setView] = useState<"choose" | "nocode">("choose");
  const [sdkOpen, setSdkOpen] = useState(false);

  // Every fresh open starts at the welcome screen (each flow keeps its own draft).
  useEffect(() => {
    if (open) setView("choose");
  }, [open]);

  const proceed = () => {
    if (path === "sdk") {
      onOpenChange(false);
      setSdkOpen(true);
    } else if (path === "nocode") {
      setView("nocode");
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="min-w-3xl max-w-3xl h-[78vh] flex flex-col p-0 gap-0 overflow-hidden font-sans">
          {view === "nocode" ? (
            <NoCodeRegisterFlow
              onBack={() => setView("choose")}
              onDone={() => onOpenChange(false)}
            />
          ) : (
            <>
              <div className="flex flex-1 flex-col overflow-y-auto p-8">
                <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col">
                  <div className="space-y-2 text-center">
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/50 px-3 py-1 text-[11px] font-medium text-muted-foreground">
                      Register an agent
                    </span>
                    <DialogTitle className="text-2xl font-semibold tracking-tight text-foreground">
                      Welcome
                    </DialogTitle>
                    <DialogDescription className="text-lg leading-tight">
                      Start putting your agent to work by selecting how
                      it&apos;s built.
                    </DialogDescription>
                  </div>

                  <div className="my-auto py-6">
                    <div
                      role="radiogroup"
                      className="grid grid-cols-1 gap-4 sm:grid-cols-2"
                    >
                      <PathCard
                        selected={path === "sdk"}
                        onSelect={() => setPath("sdk")}
                        icon={Code2}
                        title="Catelog SDK"
                        badge="Code-first"
                        body="Your agent runs on your own server with the Catelog SDK. Full control over streaming, timeouts and execution modes."
                        logos={SDK_LOGOS}
                        moreText="More"
                        // footnote="Python and TypeScript · works with 10+ frameworks"
                      />
                      <PathCard
                        selected={path === "nocode"}
                        onSelect={() => setPath("nocode")}
                        icon={Workflow}
                        title="No-Code / Workflow"
                        badge="Webhooks"
                        body="Already built a workflow in a visual builder? Connect its webhook and publish it, no code needed."
                        logos={NOCODE_LOGOS}
                        // footnote="n8n available now · Dify, Langflow and Flowise coming soon"
                      />
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-center gap-2.5 pt-2 text-center text-sm">
                    <span>
                      Don&apos;t know where to start or how to register an
                      agent?
                    </span>
                    <Link
                      href="/docs"
                      onClick={() => onOpenChange(false)}
                      className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1 text-xs font-medium text-foreground shadow-2xs transition-colors hover:bg-muted cursor-pointer"
                    >
                      <BookOpen className="size-3.5" />
                      Read docs
                    </Link>
                  </div>
                </div>
              </div>

              <div className="flex shrink-0 items-center justify-between border-t border-border bg-card/50 p-4 px-6">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => onOpenChange(false)}
                  className="cursor-pointer"
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  size="sm"
                  disabled={!path}
                  onClick={proceed}
                  className="cursor-pointer gap-1.5"
                >
                  Continue
                  <ArrowRight className="size-3.5" />
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      <RegisterAgentDialog open={sdkOpen} onOpenChange={setSdkOpen} />
    </>
  );
}
