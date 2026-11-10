"use client";

import React, { useEffect, useState } from "react";
import { useMutation } from "convex/react";
import { toast } from "sonner";
import { api } from "../../../../convex/_generated/api";
import { Check, CircleAlert, Copy, Globe, Loader2, RefreshCw } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { refreshAgentPage } from "@/app/actions/agent-page-cache";
import { SAME_VERSION_MESSAGE, sameVersion } from "@/lib/agent-version";
import type { AgentWithPricing } from "./agent-card";

interface InspectResult {
  health: { status?: string };
  manifest: {
    id?: string;
    version?: string;
    changelog?: string;
    capabilities?: {
      streaming?: boolean;
      delta_stream?: boolean;
      max_timeout_seconds?: number;
      execution_modes?: string[];
    };
    input_schema?: Record<string, unknown>;
    output_schema?: Record<string, unknown>;
  };
  latencyMs: number;
}

/** Convex wraps thrown messages; keep only the first readable line. */
const cleanError = (e: unknown, fallback: string) =>
  (e instanceof Error ? e.message.replace(/^[\s\S]*Uncaught Error:\s*/, "").split("\n")[0] : "") || fallback;

export function ReRegisterAgentDialog({
  agent,
  open,
  onOpenChange,
}: {
  agent: AgentWithPricing;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const reRegister = useMutation(api.agents.reRegister);
  const [url, setUrl] = useState(agent.baseUrl);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  // Start from the agent's current endpoint every time the dialog opens
  useEffect(() => {
    if (open) {
      setUrl(agent.baseUrl);
      setError("");
      setBusy(false);
    }
  }, [open, agent.baseUrl]);

  const submit = async () => {
    if (!url.trim() || busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/agents/inspect", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Check failed.");
      const found = data as InspectResult;
      if (found.health?.status !== "ready") {
        throw new Error(`Your agent reported "${found.health?.status ?? "unknown"}" on /health. It must be ready.`);
      }
      const m = found.manifest;
      const version = m.version?.trim();
      if (!version) throw new Error("Your agent's /schema did not include a version.");
      if (sameVersion(version, agent.version)) {
        setError(`${SAME_VERSION_MESSAGE} Your agent still reports v${version}.`);
        return;
      }

      const caps = m.capabilities;
      const r = await reRegister({
        agentId: agent._id,
        baseUrl: url.trim(),
        version,
        manifestAgentId: m.id,
        capabilities: caps && {
          streaming: caps.streaming,
          delta_stream: caps.delta_stream,
          max_timeout_seconds: caps.max_timeout_seconds,
          execution_modes: caps.execution_modes,
        },
        inputSchemaJson: JSON.stringify(m.input_schema ?? {}),
        outputSchemaJson: JSON.stringify(m.output_schema ?? {}),
        changelog: typeof m.changelog === "string" ? m.changelog : undefined,
        latencyMs: found.latencyMs,
      });
      await refreshAgentPage(r.slug);
      toast.success(`${r.name} updated: v${r.previousVersion} → v${r.version}`);
      onOpenChange(false);
    } catch (e) {
      setError(cleanError(e, "Could not re-register the agent."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="min-w-3xl max-w-3xl min-h-[60vh] gap-6 p-8">
        <DialogHeader className="space-y-1.5 text-left">
          <DialogTitle className="flex items-center gap-2 text-base font-semibold">
            <RefreshCw className="size-4" />
            Re-register {agent.name}
          </DialogTitle>
          <DialogDescription className="text-xs leading-relaxed text-muted-foreground">
            We check your agent&apos;s{" "}
            <code className="font-mono font-medium text-foreground">/health</code> and{" "}
            <code className="font-mono font-medium text-foreground">/schema</code>, then publish the update if the
            version in your code has changed. Current version: <b className="text-foreground">v{agent.version}</b>.
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
          className="flex flex-1 flex-col gap-3"
        >
          <div className="flex items-center justify-between">
            <label htmlFor="re-register-url" className="text-xs font-medium text-foreground">
              Agent URL
            </label>
            <button
              type="button"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(agent.baseUrl);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                } catch {
                  // clipboard blocked
                }
              }}
              className="inline-flex cursor-pointer items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground"
              title="Copy the previously registered URL"
            >
              {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
              Copy previous URL
            </button>
          </div>
          <div className="flex items-center rounded-lg border border-zinc-300 bg-background p-1 pl-3 shadow-2xs transition-all focus-within:border-foreground focus-within:ring-2 focus-within:ring-foreground/10 dark:border-zinc-700">
            <Globe className="mr-2.5 size-4 shrink-0 text-muted-foreground" />
            <input
              id="re-register-url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              spellCheck={false}
              autoComplete="off"
              placeholder="https://my-agent.fly.dev"
              className="h-9 flex-1 border-none bg-transparent pr-2 font-mono text-xs text-foreground outline-none placeholder:text-muted-foreground/60 sm:text-sm"
            />
          </div>

          {busy && (
            <p className="text-[11px] text-muted-foreground">
              Checking your agent. A sleeping server can take up to 2 minutes to wake up.
            </p>
          )}
          {error && (
            <div className="flex items-start gap-2.5 rounded-lg border border-destructive/40 bg-destructive/5 p-3.5">
              <CircleAlert className="mt-0.5 size-4 shrink-0 text-destructive" />
              <p className="text-xs text-foreground">{error}</p>
            </div>
          )}

          <div className="mt-auto flex justify-end gap-2 pt-4">
            <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(false)} className="cursor-pointer">
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={!url.trim() || busy} className="cursor-pointer gap-1.5">
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
              {busy ? "Checking…" : "Check & re-register"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
