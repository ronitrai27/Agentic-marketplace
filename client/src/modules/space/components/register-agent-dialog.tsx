"use client";

import React, { useRef, useState } from "react";
import {
  Check,
  CircleAlert,
  CircleCheck,
  Loader2,
  Search,
  Brain,
  Globe,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { DryRunStep } from "./dry-run-step";

const FLOW = ["Check", "Dry Run", "Publish", "Sign contract"];

const CHECK_STAGES = [
  "Reaching your server",
  "Checking /health",
  "Identifying schema",
  "Validating protocol",
];

type JsonObj = Record<string, unknown>;

interface Manifest {
  id?: string;
  name?: string;
  version?: string;
  description?: string;
  protocol_version?: string;
  capabilities?: {
    streaming?: boolean;
    delta_stream?: boolean;
    max_timeout_seconds?: number;
    execution_modes?: string[];
  };
  input_schema?: JsonObj;
  output_schema?: JsonObj;
}

interface Health {
  status?: string;
  protocol_version?: string;
  uptime_seconds?: number;
  environment_ready?: boolean;
}

interface InspectResult {
  health: Health;
  manifest: Manifest;
  latencyMs: number;
}

type Phase = "idle" | "checking" | "done" | "error";

interface Row {
  name: string;
  type: string;
  required: boolean;
  description?: string;
}

function typeOf(p: JsonObj): string {
  if (Array.isArray(p.enum))
    return `enum(${(p.enum as unknown[]).join(" | ")})`;
  const t = Array.isArray(p.type) ? (p.type as string[]).join(" | ") : p.type;
  if (t === "array") {
    const items = p.items as JsonObj | undefined;
    return `${items ? typeOf(items) : "any"}[]`;
  }
  return typeof t === "string" ? t : "any";
}

function toRows(schema?: JsonObj): Row[] {
  const props = schema?.properties as Record<string, JsonObj> | undefined;
  if (!props) return [];
  const required = new Set((schema?.required as string[] | undefined) ?? []);
  return Object.entries(props).map(([name, p]) => ({
    name,
    type: typeOf(p ?? {}),
    required: required.has(name),
    description: typeof p?.description === "string" ? p.description : undefined,
  }));
}

function SchemaBlock({ title, schema }: { title: string; schema?: JsonObj }) {
  const [raw, setRaw] = useState(false);
  const rows = toRows(schema);
  const open = schema?.additionalProperties === true && rows.length === 0;

  return (
    <div className="rounded-lg border border-border overflow-hidden">
      <div className="flex items-center justify-between px-3.5 py-2 border-b border-border bg-muted/40">
        <span className="text-xs font-medium text-foreground">{title}</span>
        <button
          type="button"
          onClick={() => setRaw(!raw)}
          className="text-[11px] text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
        >
          {raw ? "Table" : "JSON"}
        </button>
      </div>
      {raw ? (
        <pre className="p-3.5 text-[11px] font-mono leading-relaxed overflow-auto max-h-64 text-foreground/80">
          {JSON.stringify(schema ?? {}, null, 2)}
        </pre>
      ) : rows.length > 0 ? (
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-[11px] text-muted-foreground">
              <th className="font-normal px-3.5 py-2 w-1/4">Field</th>
              <th className="font-normal px-3.5 py-2 w-1/4">Type</th>
              <th className="font-normal px-3.5 py-2">Description</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.name} className="border-t border-border align-top">
                <td className="px-3.5 py-2 font-mono text-foreground">
                  {r.name}
                  {r.required && (
                    <span
                      className="ml-1 text-muted-foreground"
                      title="Required"
                    >
                      *
                    </span>
                  )}
                </td>
                <td className="px-3.5 py-2 font-mono text-muted-foreground">
                  {r.type}
                </td>
                <td className="px-3.5 py-2 text-muted-foreground">
                  {r.description ?? "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="px-3.5 py-3 text-xs text-muted-foreground">
          {open
            ? "Accepts any JSON object. Define an inputSchema in your agent to generate a buyer form."
            : "No fields declared."}
        </p>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="text-xs font-medium text-foreground mt-0.5 truncate">
        {value}
      </p>
    </div>
  );
}

export function RegisterAgentDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [url, setUrl] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [stage, setStage] = useState(0);
  const [error, setError] = useState("");
  const [result, setResult] = useState<InspectResult | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const stop = () => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
  };

  const check = async () => {
    if (!url.trim() || phase === "checking") return;
    setPhase("checking");
    setStage(0);
    setError("");
    setResult(null);

    timer.current = setInterval(
      () => setStage((s) => Math.min(s + 1, CHECK_STAGES.length - 1)),
      900,
    );

    try {
      const res = await fetch("/api/agents/inspect", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = await res.json();
      stop();
      if (!res.ok) throw new Error(data.error ?? "Check failed.");
      setStage(CHECK_STAGES.length);
      setResult(data as InspectResult);
      setPhase("done");
    } catch (e) {
      stop();
      setError(e instanceof Error ? e.message : "Check failed.");
      setPhase("error");
    }
  };

  const [currentStep, setCurrentStep] = useState(0);
  const [usageOk, setUsageOk] = useState(false);
  const m = result?.manifest;
  const ready = result?.health.status === "ready";

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          stop();
          setCurrentStep(0);
        }
        onOpenChange(o);
      }}
    >
      <DialogContent className="min-w-3xl max-w-3xl h-[78vh] flex flex-col p-0 gap-0 overflow-hidden">
        {/* Fixed Top: Stepper */}
        <div className="p-6 pb-4 border-b border-border shrink-0 mt-2">
          <div className="grid grid-cols-4 gap-2 pr-8">
            {FLOW.map((label, i) => (
              <div key={label} className="space-y-1.5">
                <div
                  className={`h-1 rounded-full ${
                    i === currentStep
                      ? "bg-foreground"
                      : i < currentStep
                        ? "bg-foreground/50"
                        : "bg-border"
                  }`}
                />
                <p
                  className={`text-[11px] ${
                    i === currentStep
                      ? "text-foreground font-medium"
                      : "text-muted-foreground"
                  }`}
                >
                  {label}
                </p>
              </div>
            ))}
          </div>
        </div>

        {/* Scrollable Middle: Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {result && m && (
            <div className={currentStep === 1 ? "block" : "hidden"}>
              <DryRunStep
                key={`${url}-${m.id ?? ""}-${result.latencyMs}`}
                url={url}
                inputSchema={m.input_schema}
                agentName={m.name}
                onUsageCheck={setUsageOk}
              />
            </div>
          )}

          <div className={currentStep === 0 ? "space-y-6" : "hidden"}>
            <DialogHeader className="space-y-1.5">
              <DialogTitle className="text-base font-semibold flex items-center gap-2">
                <div className="size-7 rounded-md border border-zinc-300 dark:border-zinc-700 bg-muted flex items-center justify-center shrink-0 shadow!">
                  <Brain className="size-4 text-foreground" />
                </div>
                <span>Verify Agent Server</span>
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground leading-relaxed">
                Enter your agent&apos;s public URL to verify reachability, probe{" "}
                <code className="font-mono text-foreground font-medium px-1 py-0.5 rounded bg-muted/70">
                  /health
                </code>
                , and inspect{" "}
                <code className="font-mono text-foreground font-medium px-1 py-0.5 rounded bg-muted/70">
                  /schema
                </code>{" "}
                endpoints.
              </DialogDescription>
            </DialogHeader>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                check();
              }}
              className="relative flex items-center rounded-lg border border-zinc-300 dark:border-zinc-700 bg-background shadow-2xs focus-within:border-foreground focus-within:ring-2 focus-within:ring-foreground/10 transition-all p-1 pl-3"
            >
              <Globe className="size-4 text-muted-foreground shrink-0 mr-2.5" />
              <input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://my-agent.fly.dev"
                spellCheck={false}
                autoComplete="off"
                className="flex-1 h-9 bg-transparent text-xs sm:text-sm font-mono text-foreground placeholder:text-muted-foreground/60 outline-none border-none pr-2"
              />
              <Button
                type="submit"
                size="sm"
                disabled={!url.trim() || phase === "checking"}
                className="h-8 px-4 rounded-md font-medium text-xs bg-foreground text-background hover:bg-foreground/90 disabled:opacity-40 transition-all cursor-pointer shadow-xs shrink-0 gap-1.5"
              >
                {phase === "checking" ? (
                  <>
                    <Loader2 className="size-3.5 animate-spin" />
                    <span>Checking...</span>
                  </>
                ) : (
                  <>
                    <Search className="size-3.5" />
                    <span>Check Server</span>
                  </>
                )}
              </Button>
            </form>

            {phase === "checking" && (
              <ul className="space-y-2.5 rounded-lg border border-border p-4">
                {CHECK_STAGES.map((label, i) => (
                  <li key={label} className="flex items-center gap-2.5 text-xs">
                    {i < stage ? (
                      <Check className="size-3.5 text-foreground" />
                    ) : i === stage ? (
                      <Loader2 className="size-3.5 animate-spin text-foreground" />
                    ) : (
                      <span className="size-3.5 flex items-center justify-center">
                        <span className="size-1.5 rounded-full bg-border" />
                      </span>
                    )}
                    <span
                      className={
                        i <= stage ? "text-foreground" : "text-muted-foreground"
                      }
                    >
                      {label}
                      {i === stage ? "…" : ""}
                    </span>
                  </li>
                ))}
              </ul>
            )}

            {phase === "error" && (
              <div className="flex items-start gap-2.5 rounded-lg border border-destructive/40 bg-destructive/5 p-4">
                <CircleAlert className="size-4 text-destructive shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs font-medium text-foreground">
                    Couldn&apos;t verify this server
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {error}
                  </p>
                </div>
              </div>
            )}

            {phase === "done" && m && result && (
              <div className="space-y-4">
                <div className="rounded-lg border border-border p-4 space-y-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">
                        {m.name ?? "Unnamed agent"}
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                        {m.description || "No description provided."}
                      </p>
                    </div>
                    <span className="inline-flex items-center gap-1.5 shrink-0 rounded-full border border-border px-2.5 py-1 text-[11px] font-medium text-foreground">
                      {ready ? (
                        <CircleCheck className="size-3.5" />
                      ) : (
                        <CircleAlert className="size-3.5" />
                      )}
                      {ready
                        ? "Reachable · Ready"
                        : (result.health.status ?? "Unknown")}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-4 border-t border-border">
                    <Stat label="Version" value={m.version ?? "—"} />
                    <Stat
                      label="Protocol"
                      value={
                        m.protocol_version ??
                        result.health.protocol_version ??
                        "—"
                      }
                    />
                    <Stat label="Latency" value={`${result.latencyMs} ms`} />
                    <Stat
                      label="Streaming"
                      value={m.capabilities?.streaming ? "Supported" : "No"}
                    />
                    <Stat
                      label="Execution modes"
                      value={m.capabilities?.execution_modes?.join(", ") ?? "—"}
                    />
                    <Stat
                      label="Max timeout"
                      value={
                        m.capabilities?.max_timeout_seconds
                          ? `${m.capabilities.max_timeout_seconds}s`
                          : "—"
                      }
                    />
                    <Stat
                      label="Environment"
                      value={
                        result.health.environment_ready ? "Ready" : "Not ready"
                      }
                    />
                    <Stat label="Agent ID" value={m.id ?? "—"} />
                  </div>
                </div>

                <SchemaBlock title="Input schema" schema={m.input_schema} />
                <SchemaBlock title="Output schema" schema={m.output_schema} />
              </div>
            )}
          </div>
        </div>

        {/* Fixed Bottom: Previous / Next */}
        <div className="p-4 px-6 border-t border-border bg-card/50 flex items-center justify-between shrink-0">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={currentStep === 0}
            onClick={() => setCurrentStep((s) => Math.max(0, s - 1))}
            className="cursor-pointer"
          >
            Previous
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={
              currentStep === 0
                ? !(phase === "done" && ready)
                : currentStep === 1
                  ? !usageOk
                  : true
            }
            onClick={() =>
              setCurrentStep((s) => Math.min(FLOW.length - 1, s + 1))
            }
            className="cursor-pointer"
          >
            {currentStep === FLOW.length - 1 ? "Complete" : "Next"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
