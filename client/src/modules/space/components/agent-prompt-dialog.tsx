"use client";

import React, { useState } from "react";
import Image from "next/image";
import { Check, Copy, Package } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type PromptPm = "npm" | "pnpm" | "bun";

const promptInstall: Record<PromptPm, string> = {
  npm: "npm install catelog zod",
  pnpm: "pnpm add catelog zod",
  bun: "bun add catelog zod",
};

const buildTsPrompt = (pm: PromptPm) =>
  `Catelog turns any AI agent (OpenAI, Vercel AI SDK, LangGraph, or plain TypeScript) into a marketplace-ready HTTP service. You write one execute() function;
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

function PmLogo({ pm }: { pm: PromptPm }) {
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

export function AgentPromptDialog({
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
          <DialogTitle>Register with AI Prompt</DialogTitle>
          <DialogDescription>
            Choose a language. Paste this prompt into your coding assistant to
            build and register your agent.
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
            {copied ? (
              <Check className="size-3.5" />
            ) : (
              <Copy className="size-3.5" />
            )}
            <span>{copied ? "Copied" : "Copy prompt"}</span>
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
