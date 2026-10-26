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
} from "lucide-react";
import { RegisterAgentDialog } from "@/modules/space/components/register-agent-dialog";

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
    <div className="flex-1 h-full overflow-y-auto scrollbar-thin px-6 py-8 lg:px-10 bg-background">
      <div className="max-w-3xl mx-auto space-y-10">
        <div>
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-foreground">
            Ready to register your agents and start generating revenue?
          </h1>
          <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
            Bring your own server (BYOS). Connect any agent built with the
            Catelog SDK and list it on the marketplace in a few minutes.
          </p>
        </div>

        {/* Pre-flight note */}
        <div className="flex items-start gap-3 rounded-xl border border-border bg-card p-4">
          <div className="size-8 rounded-md border border-border bg-muted/50 flex items-center justify-center shrink-0">
            <Key className="size-4 text-foreground" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground">
              Before you start
            </p>
            <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
              Make sure the Catelog SDK is installed and used correctly in your
              agent, and that your API keys are set up. Don&apos;t know how?{" "}
              <Link
                href="/docs"
                className="inline-flex items-center gap-1 font-medium text-foreground hover:underline underline-offset-4"
              >
                <BookOpen className="size-3" />
                See the docs
              </Link>
              .
            </p>
          </div>
        </div>

        {/* Trust */}
        <section className="space-y-4">
          <h2 className="text-sm font-semibold text-foreground">
            Secure by design
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-px rounded-xl border border-border bg-border overflow-hidden">
            {trust.map((t) => (
              <div key={t.title} className="p-4 bg-card">
                <t.icon className="size-4 text-foreground" />
                <p className="text-xs font-medium text-foreground mt-3">
                  {t.title}
                </p>
                <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                  {t.description}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* Steps */}
        <section className="space-y-4">
          <h2 className="text-sm font-semibold text-foreground">
            How publishing works
          </h2>
          <ol className="rounded-xl border border-border divide-y divide-border overflow-hidden">
            {steps.map((s, i) => (
              <li
                key={s.title}
                className={`flex items-center gap-4 px-4 py-3.5 ${i === 0 ? "bg-card" : "bg-muted/30"}`}
              >
                <span
                  className={`size-6 rounded-full flex items-center justify-center text-[11px] font-mono shrink-0 ${
                    i === 0
                      ? "bg-foreground text-background"
                      : "border border-border text-muted-foreground"
                  }`}
                >
                  {i + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <p
                    className={`text-sm font-medium ${i === 0 ? "text-foreground" : "text-muted-foreground"}`}
                  >
                    {s.title}
                  </p>
                  <p className="text-xs text-muted-foreground">{s.note}</p>
                </div>
                {i === 0 && (
                  <button
                    type="button"
                    onClick={() => setOpen(true)}
                    className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors cursor-pointer"
                  >
                    <span>Register your agent</span>
                    <ArrowRight className="size-3.5" />
                  </button>
                )}
              </li>
            ))}
          </ol>
          <p className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <FileSignature className="size-3.5" />
            Once published, you&apos;ll sign the creator contract to start
            earning.
          </p>
        </section>
      </div>

      <RegisterAgentDialog open={open} onOpenChange={setOpen} />
    </div>
  );
}
