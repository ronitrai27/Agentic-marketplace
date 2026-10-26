"use client";

import React, { useRef, useState } from "react";
import {
  Check,
  CircleAlert,
  CircleCheck,
  Loader2,
  Search,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const FLOW = ["Register", "Configure", "Publish", "Sign contract"];

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
  if (Array.isArray(p.enum)) return `enum(${(p.enum as unknown[]).join(" | ")})`;
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
                    <span className="ml-1 text-muted-foreground" title="Required">
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

  const m = result?.manifest;
  const ready = result?.health.status === "ready";

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) stop();
        onOpenChange(o);
      }}
    >
      <DialogContent className="sm:max-w-3xl max-h-[88vh] overflow-y-auto gap-6 p-6">
        {/* Stepper: current step dark, the rest pending */}
        <div className="grid grid-cols-4 gap-2 pr-6">
          {FLOW.map((label, i) => (
            <div key={label} className="space-y-1.5">
              <div
                className={`h-1 rounded-full ${i === 0 ? "bg-foreground" : "bg-border"}`}
              />
              <p
                className={`text-[11px] ${i === 0 ? "text-foreground font-medium" : "text-muted-foreground"}`}
              >
                {label}
              </p>
            </div>
          ))}
        </div>

        <DialogHeader>
          <DialogTitle className="text-base font-semibold">
            Register your agent
          </DialogTitle>
          <DialogDescription>
            Enter the public URL that serves{" "}
            <code className="font-mono">/health</code> and{" "}
            <code className="font-mono">/schema</code>. We only read these two
            endpoints.
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            check();
          }}
          className="flex gap-2"
        >
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://my-agent.fly.dev"
            spellCheck={false}
            autoComplete="off"
            className="flex-1 h-9 rounded-md border border-border bg-background px-3 text-sm font-mono text-foreground placeholder:text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
          />
          <button
            type="submit"
            disabled={!url.trim() || phase === "checking"}
            className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:pointer-events-none transition-colors cursor-pointer"
          >
            {phase === "checking" ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Search className="size-3.5" />
            )}
            Check
          </button>
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
              <p className="text-xs text-muted-foreground mt-0.5">{error}</p>
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
                    m.protocol_version ?? result.health.protocol_version ?? "—"
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
                  value={result.health.environment_ready ? "Ready" : "Not ready"}
                />
                <Stat label="Agent ID" value={m.id ?? "—"} />
              </div>
            </div>

            <SchemaBlock title="Input schema" schema={m.input_schema} />
            <SchemaBlock title="Output schema" schema={m.output_schema} />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
