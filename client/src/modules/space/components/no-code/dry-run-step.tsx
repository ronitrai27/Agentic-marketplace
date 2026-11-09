"use client";

import React, { useState } from "react";
import { useAction } from "convex/react";
import {
  Check,
  CircleAlert,
  CircleCheck,
  FlaskConical,
  Loader2,
  Play,
  Send,
  Timer,
  X,
} from "lucide-react";
import { api } from "../../../../../convex/_generated/api";
import { SectionHeading } from "../section-heading";
import { FIELD_ICON } from "./schema-builder";
import { HEADER_NAME } from "./connect-step";
import { checkOutput, sampleValue, type FieldCheck, type SchemaField } from "./schema-fields";

export interface DryRunResult {
  ok: boolean;
  latencyMs?: number;
  output?: unknown;
  message?: string;
  checks?: FieldCheck[];
}

function ValueInput({
  field,
  value,
  onChange,
}: {
  field: SchemaField;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const base =
    "w-full rounded-md border border-border bg-background px-3 py-2 text-xs text-foreground outline-none focus:border-foreground/40 focus:ring-2 focus:ring-foreground/10 placeholder:text-muted-foreground/50";

  if (field.type === "boolean") {
    const on = value === true;
    return (
      <div className="flex rounded-lg border border-border p-0.5 w-fit">
        {[true, false].map((b) => (
          <button
            key={String(b)}
            type="button"
            onClick={() => onChange(b)}
            className={`rounded-md px-3 py-1 text-[11px] font-medium cursor-pointer ${
              on === b ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {b ? "Yes" : "No"}
          </button>
        ))}
      </div>
    );
  }
  if (field.type === "choice") {
    return (
      <div className="flex flex-wrap gap-1.5">
        {field.options.map((o) => (
          <button
            key={o}
            type="button"
            onClick={() => onChange(o)}
            className={`rounded-full border px-3 py-1 font-mono text-[11px] cursor-pointer ${
              value === o
                ? "border-foreground bg-foreground text-background"
                : "border-border bg-background text-foreground hover:border-foreground/40"
            }`}
          >
            {o}
          </button>
        ))}
      </div>
    );
  }
  if (field.type === "list") {
    const list = Array.isArray(value) ? (value as string[]) : [];
    return (
      <input
        value={list.join(", ")}
        onChange={(e) =>
          onChange(
            e.target.value
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean),
          )
        }
        placeholder="first, second, third"
        className={base}
      />
    );
  }
  if (field.type === "number") {
    return (
      <input
        type="number"
        value={typeof value === "number" ? value : ""}
        onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))}
        className={base}
      />
    );
  }
  return (
    <input
      value={typeof value === "string" ? value : ""}
      onChange={(e) => onChange(e.target.value)}
      placeholder={field.description || `Sample ${field.name}`}
      className={base}
    />
  );
}

const STAGES = ["Sending the request", "Waiting for n8n", "Checking the answer"];

export function DryRunStep({
  url,
  inputFields,
  outputFields,
  values,
  onValuesChange,
  result,
  onResult,
}: {
  url: string;
  inputFields: SchemaField[];
  outputFields: SchemaField[];
  values: Record<string, unknown>;
  onValuesChange: (v: Record<string, unknown>) => void;
  result: DryRunResult | null;
  onResult: (r: DryRunResult | null) => void;
}) {
  const testWebhook = useAction(api.n8nAgents.testWebhook);
  const [running, setRunning] = useState(false);
  const [stage, setStage] = useState(0);

  const valueOf = (f: SchemaField) => (f.name in values ? values[f.name] : sampleValue(f));
  const body: Record<string, unknown> = {};
  for (const f of inputFields) {
    const v = valueOf(f);
    if (v === undefined || (!f.required && (v === "" || (Array.isArray(v) && v.length === 0)))) continue;
    body[f.name] = v;
  }
  const missing = inputFields.filter((f) => {
    const v = valueOf(f);
    return f.required && (v === undefined || v === "" || (Array.isArray(v) && v.length === 0));
  });

  const run = async () => {
    setRunning(true);
    setStage(0);
    onResult(null);
    const timer = setInterval(() => setStage((s) => Math.min(s + 1, 1)), 900);
    try {
      const res = await testWebhook({ url: url.trim(), inputJson: JSON.stringify(body) });
      clearInterval(timer);
      setStage(2);
      if (!res.ok) {
        onResult({ ok: false, message: res.message });
        return;
      }
      const checks = checkOutput(outputFields, res.output);
      onResult({
        ok: checks.every((c) => c.ok),
        latencyMs: res.latencyMs,
        output: res.output,
        checks,
        message: checks.every((c) => c.ok)
          ? undefined
          : "The answer doesn't match your output fields. Fix the workflow or the output fields, then run again.",
      });
    } catch (e) {
      clearInterval(timer);
      onResult({ ok: false, message: e instanceof Error ? e.message.split("\n")[0] : "Dry run failed." });
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="space-y-8 pb-4">
      <section className="space-y-4 border-b border-border pb-8">
        <SectionHeading
          icon={FlaskConical}
          title="Dry run"
          right={
            <button
              type="button"
              onClick={run}
              disabled={running || missing.length > 0}
              className="inline-flex h-8 items-center gap-1.5 rounded-md bg-foreground px-3.5 text-xs font-medium text-background shadow-xs hover:bg-foreground/90 disabled:opacity-40 cursor-pointer"
            >
              {running ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}
              {running ? "Running…" : result ? "Run again" : "Run dry run"}
            </button>
          }
        >
          We call your webhook exactly like a buyer would. Fill in a sample input.
        </SectionHeading>

        <div className="rounded-lg border border-border bg-card shadow-2xs divide-y divide-border">
          {inputFields.map((f) => {
            const Icon = FIELD_ICON[f.type];
            return (
              <div key={f.id} className="grid grid-cols-1 gap-2 p-3 sm:grid-cols-[180px_1fr] sm:items-center">
                <div className="flex items-center gap-2 min-w-0">
                  <Icon className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="truncate font-mono text-xs font-medium text-foreground">{f.name}</span>
                  {f.required && <span className="text-[10px] text-muted-foreground">*</span>}
                </div>
                <ValueInput
                  field={f}
                  value={valueOf(f)}
                  onChange={(v) => onValuesChange({ ...values, [f.name]: v })}
                />
              </div>
            );
          })}
        </div>

        <details className="group rounded-lg border border-border bg-muted/20">
          <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-[11px] font-medium text-muted-foreground hover:text-foreground">
            <Send className="size-3" />
            Request preview
          </summary>
          <pre className="overflow-auto border-t border-border p-3 font-mono text-[11px] leading-relaxed text-foreground/80">
{`POST ${url.trim()}
Content-Type: application/json
${HEADER_NAME}: mak_live_••••••••

${JSON.stringify(body, null, 2)}`}
          </pre>
        </details>
      </section>

      {running && (
        <ul className="space-y-2.5 rounded-lg border border-border p-4">
          {STAGES.map((label, i) => (
            <li key={label} className="flex items-center gap-2.5 text-xs">
              {i < stage ? (
                <Check className="size-3.5 text-foreground" />
              ) : i === stage ? (
                <Loader2 className="size-3.5 animate-spin text-foreground" />
              ) : (
                <span className="flex size-3.5 items-center justify-center">
                  <span className="size-1.5 rounded-full bg-border" />
                </span>
              )}
              <span className={i <= stage ? "text-foreground" : "text-muted-foreground"}>{label}</span>
            </li>
          ))}
        </ul>
      )}

      {!running && result && (
        <div
          className={`overflow-hidden rounded-lg border ${
            result.ok ? "border-border" : "border-destructive/40"
          }`}
        >
          <div
            className={`flex items-center justify-between gap-3 px-4 py-3 ${
              result.ok ? "bg-muted/40" : "bg-destructive/5"
            }`}
          >
            <div className="flex items-center gap-2.5">
              {result.ok ? (
                <CircleCheck className="size-4 text-foreground" />
              ) : (
                <CircleAlert className="size-4 text-destructive" />
              )}
              <div>
                <p className="text-sm font-medium text-foreground">
                  {result.ok ? "Dry run passed" : "Dry run failed"}
                </p>
                {result.message && <p className="text-xs text-muted-foreground mt-0.5">{result.message}</p>}
              </div>
            </div>
            {result.latencyMs !== undefined && (
              <span className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-2.5 py-1 text-[11px] font-medium tabular-nums text-foreground">
                <Timer className="size-3" />
                {(result.latencyMs / 1000).toFixed(1)}s
              </span>
            )}
          </div>

          {result.checks && (
            <ul className="divide-y divide-border border-t border-border">
              {result.checks.map((c) => (
                <li key={c.name} className="flex items-center gap-2.5 px-4 py-2 text-xs">
                  {c.ok ? (
                    <Check className="size-3.5 text-foreground" />
                  ) : (
                    <X className="size-3.5 text-destructive" />
                  )}
                  <span className="font-mono font-medium text-foreground">{c.name}</span>
                  <span className="text-muted-foreground">{c.message}</span>
                </li>
              ))}
            </ul>
          )}

          {result.output !== undefined && (
            <pre className="max-h-64 overflow-auto border-t border-border bg-muted/20 p-4 font-mono text-[11px] leading-relaxed text-foreground/80">
              {JSON.stringify(result.output, null, 2)}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
