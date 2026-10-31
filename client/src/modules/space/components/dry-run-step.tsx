"use client";

import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { TestTokenPanel } from "./test-token-panel";
import { DRY_RUN_TIMEOUT_SECONDS } from "@/lib/dry-run-limits";
import {
  analyzeUsage,
  normalizeModelId,
  priceFor,
  providerOf,
  type UsageReport,
} from "@/lib/model-pricing";
import { modelIcon } from "@/lib/agent-display";
import {
  Activity,
  ArrowRight,
  Check,
  ChevronDown,
  CircleAlert,
  CircleCheck,
  Circle,
  Cpu,
  KeyRound,
  Loader2,
  FileText,
  Info,
  Play,
  SlidersHorizontal,
  Upload,
  X,
} from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import { RainbowButton } from "@/components/ui/rainbow-button";
import { AgentPromptDialog } from "./agent-prompt-dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type JsonObj = Record<string, any>;

type RunEvent =
  | { kind: "progress"; label: string; percent?: number; ts: number }
  | {
      kind: "step" | "activity" | "event" | "delta" | "info";
      label: string;
      data?: unknown;
      ts: number;
    }
  | {
      kind: "completed";
      output: unknown;
      telemetry?: JsonObj;
      durationMs?: number;
      ts: number;
    }
  | { kind: "failed"; error: { code?: string; message: string }; ts: number };

type RunState = "idle" | "running" | "completed" | "failed";

/* ───────── Schema → form ───────── */

function defaultFor(p: JsonObj): unknown {
  if (p.default !== undefined) return p.default;
  if (p.type === "boolean") return false;
  return "";
}

/* ───────── File fields (base64 strings) ───────── */

const MAX_FILE_BYTES = 3 * 1024 * 1024; // base64 adds ~33%, keeps the request under hosting body limits

interface FileValue {
  base64: string;
  name: string;
  size: number;
}

/** A string field that carries a file as base64 gets an upload control instead of a text box. */
function isFileField(name: string, p: JsonObj): boolean {
  const type = Array.isArray(p.type) ? p.type[0] : p.type;
  if (type !== "string") return false;
  return (
    p.contentEncoding === "base64" ||
    p.format === "byte" ||
    p.format === "binary" ||
    p.format === "data-url" ||
    /base64/i.test(name)
  );
}

/** resume_base64 -> resume_filename, fileBase64 -> fileFilename / fileName. */
function companionNameKey(
  fileKey: string,
  props: Record<string, JsonObj>,
): string | undefined {
  const stem = fileKey.replace(/[_-]?base64$/i, "");
  return [
    `${stem}_filename`,
    `${stem}_name`,
    `${stem}Filename`,
    `${stem}FileName`,
    `${stem}Name`,
  ].find((c) => c in props);
}

/** Filename fields that are filled automatically from an upload, so the form hides them. */
function companionKeysOf(props: Record<string, JsonObj>): Set<string> {
  const out = new Set<string>();
  for (const [k, p] of Object.entries(props)) {
    if (!isFileField(k, p)) continue;
    const c = companionNameKey(k, props);
    if (c) out.add(c);
  }
  return out;
}

function acceptFor(p: JsonObj): string | undefined {
  const exts = Array.from(
    new Set(
      (
        (p.description as string | undefined)?.match(/\.[a-z0-9]{2,5}\b/gi) ??
        []
      ).map((e) => e.toLowerCase()),
    ),
  );
  return exts.length ? exts.join(",") : undefined;
}

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function readBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(new Error("Could not read the file."));
    reader.readAsDataURL(file);
  });
}

function FileInput({
  schema,
  value,
  onChange,
  disabled,
}: {
  schema: JsonObj;
  value: unknown;
  onChange: (v: unknown) => void;
  disabled: boolean;
}) {
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const file = value && typeof value === "object" ? (value as FileValue) : null;

  const pick = async (f?: File) => {
    if (!f) return;
    if (f.size > MAX_FILE_BYTES) {
      setError(
        `File is too large. Max ${fmtSize(MAX_FILE_BYTES)} for a dry run.`,
      );
      return;
    }
    setError("");
    try {
      onChange({ base64: await readBase64(f), name: f.name, size: f.size });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read the file.");
    }
  };

  return (
    <div className="space-y-1.5">
      <input
        ref={inputRef}
        type="file"
        hidden
        accept={acceptFor(schema)}
        onChange={(e) => {
          pick(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      {file ? (
        <div className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2">
          <FileText className="size-4 text-foreground shrink-0" />
          <span className="text-xs text-foreground truncate flex-1">
            {file.name}
          </span>
          <span className="text-[11px] text-foreground shrink-0">
            {fmtSize(file.size)}
          </span>
          <button
            type="button"
            title="Remove file"
            disabled={disabled}
            onClick={() => onChange("")}
            className="p-0.5 rounded text-foreground hover:text-foreground cursor-pointer"
          >
            <X className="size-3.5" />
          </button>
        </div>
      ) : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          onClick={() => inputRef.current?.click()}
        >
          <Upload className="size-3.5" />
          Upload file
        </Button>
      )}
      {error && <p className="text-[11px] text-destructive">{error}</p>}
    </div>
  );
}

function FieldInput({
  name,
  schema,
  value,
  onChange,
  disabled,
}: {
  name: string;
  schema: JsonObj;
  value: unknown;
  onChange: (v: unknown) => void;
  disabled: boolean;
}) {
  const type = Array.isArray(schema.type) ? schema.type[0] : schema.type;
  const options = Array.isArray(schema.enum)
    ? (schema.enum as unknown[])
    : null;

  if (isFileField(name, schema)) {
    return (
      <FileInput
        schema={schema}
        value={value}
        onChange={onChange}
        disabled={disabled}
      />
    );
  }

  if (options && options.length <= 4) {
    return (
      <RadioGroup
        value={String(value ?? "")}
        onValueChange={(v) =>
          onChange(options.find((o) => String(o) === v) ?? v)
        }
        className="flex flex-wrap gap-4"
        disabled={disabled}
      >
        {options.map((o) => (
          <label
            key={String(o)}
            className="flex items-center gap-2 text-xs text-foreground cursor-pointer"
          >
            <RadioGroupItem value={String(o)} />
            {String(o)}
          </label>
        ))}
      </RadioGroup>
    );
  }

  if (options) {
    return (
      <Select
        value={String(value ?? "")}
        onValueChange={(v) =>
          onChange(options.find((o) => String(o) === v) ?? v)
        }
        disabled={disabled}
      >
        <SelectTrigger className="w-full">
          <SelectValue placeholder="Select…" />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={String(o)} value={String(o)}>
              {String(o)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  if (type === "boolean") {
    return (
      <Switch
        checked={Boolean(value)}
        onCheckedChange={(v) => onChange(v)}
        disabled={disabled}
      />
    );
  }

  if (type === "number" || type === "integer") {
    return (
      <Input
        type="number"
        value={String(value ?? "")}
        min={schema.minimum}
        max={schema.maximum}
        step={type === "integer" ? 1 : "any"}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }

  if (type === "array" || type === "object") {
    return (
      <Textarea
        value={String(value ?? "")}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        placeholder={
          type === "array"
            ? schema.items?.type === "string"
              ? "One item per line"
              : "JSON array"
            : "JSON object"
        }
        className="font-mono text-xs min-h-20"
      />
    );
  }

  return (
    <Input
      value={String(value ?? "")}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      placeholder={
        schema.examples?.[0] ?? (name === "url" ? "https://example.com" : "")
      }
    />
  );
}

/** Turns the form state into the JSON body the agent expects. */
function buildInput(
  schema: JsonObj | undefined,
  values: Record<string, unknown>,
  rawJson: string,
): { input?: unknown; error?: string } {
  const props = schema?.properties as Record<string, JsonObj> | undefined;
  if (!props || Object.keys(props).length === 0) {
    try {
      return { input: rawJson.trim() ? JSON.parse(rawJson) : {} };
    } catch {
      return { error: "Input must be valid JSON." };
    }
  }

  const required = new Set<string>(schema?.required ?? []);
  const input: Record<string, unknown> = {};

  const companions = companionKeysOf(props);

  for (const [key, p] of Object.entries(props)) {
    if (companions.has(key)) continue; // filled automatically from the upload
    const raw = values[key];
    const type = Array.isArray(p.type) ? p.type[0] : p.type;
    const empty = raw === "" || raw === undefined || raw === null;

    if (isFileField(key, p)) {
      if (empty) {
        if (required.has(key)) return { error: `Upload a file for "${key}".` };
        continue;
      }
      const f = raw as FileValue;
      input[key] = f.base64;
      const nameKey = companionNameKey(key, props);
      if (nameKey) input[nameKey] = f.name;
      continue;
    }

    if (empty && type !== "boolean") {
      if (required.has(key)) return { error: `"${key}" is required.` };
      continue;
    }

    if (type === "number" || type === "integer") {
      const n = Number(raw);
      if (Number.isNaN(n)) return { error: `"${key}" must be a number.` };
      input[key] = n;
    } else if (type === "array") {
      if (p.items?.type === "string" || p.items === undefined) {
        const s = String(raw);
        try {
          const parsed = JSON.parse(s);
          input[key] = Array.isArray(parsed) ? parsed : s.split("\n");
        } catch {
          input[key] = s
            .split("\n")
            .map((x) => x.trim())
            .filter(Boolean);
        }
      } else {
        try {
          input[key] = JSON.parse(String(raw));
        } catch {
          return { error: `"${key}" must be a valid JSON array.` };
        }
      }
    } else if (type === "object") {
      try {
        input[key] = JSON.parse(String(raw));
      } catch {
        return { error: `"${key}" must be valid JSON.` };
      }
    } else {
      input[key] = raw;
    }
  }
  return { input };
}

/* ───────── Presentation helpers ───────── */

type Tone = "idle" | "running" | "ok" | "fail";

const toneText: Record<Tone, string> = {
  idle: "text-foreground",
  running: "text-blue-600 dark:text-blue-400",
  ok: "text-green-600 dark:text-green-400",
  fail: "text-destructive",
};

function ToneIcon({
  tone,
  className = "size-3.5",
}: {
  tone: Tone;
  className?: string;
}) {
  const c = `${className} ${toneText[tone]}`;
  if (tone === "running") return <Loader2 className={`${c} animate-spin`} />;
  if (tone === "ok") return <CircleCheck className={c} />;
  if (tone === "fail") return <CircleAlert className={c} />;
  return <Circle className={`${className} text-muted-foreground/40`} />;
}

function SectionTitle({
  icon: Icon,
  children,
  aside,
}: {
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
  aside?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-2.5">
        <span className="size-6 rounded-md bg-foreground text-background flex items-center justify-center">
          <Icon className="size-3.5" />
        </span>
        <h4 className="text-sm font-semibold text-foreground">{children}</h4>
      </div>
      {aside}
    </div>
  );
}

/** Whole numbers get separators; fractions keep full precision (no rounding, no sci-notation). */
function fmtNumber(n: number, key = ""): string {
  const text = Number.isInteger(n)
    ? n.toLocaleString()
    : n.toFixed(12).replace(/0+$/, "").replace(/\.$/, "");
  return /cost|usd|price/i.test(key) ? `$${text}` : text;
}

function isComplex(v: unknown): v is object {
  return typeof v === "object" && v !== null;
}

function Primitive({ k, v }: { k: string; v: unknown }) {
  if (v === undefined || v === null) return <>—</>;
  if (typeof v === "number") return <>{fmtNumber(v, k)}</>;
  return <>{String(v)}</>;
}

/** Renders nested telemetry as labelled values instead of raw JSON. */
function NestedValue({ k, v }: { k: string; v: unknown }) {
  if (!isComplex(v)) {
    return (
      <span className="text-foreground">
        <Primitive k={k} v={v} />
      </span>
    );
  }

  if (Array.isArray(v)) {
    if (v.every((x) => !isComplex(x))) {
      return (
        <span className="text-foreground">
          {v
            .map((x) => <Primitive key={String(x)} k={k} v={x} />)
            .reduce<
              React.ReactNode[]
            >((acc, el, i) => (i ? [...acc, ", ", el] : [el]), [])}
        </span>
      );
    }
    return (
      <ul className="space-y-1.5">
        {v.map((item, i) => (
          <li key={i} className="rounded-md bg-muted/50 px-2.5 py-1.5">
            <NestedValue k={k} v={item} />
          </li>
        ))}
      </ul>
    );
  }

  const entries = Object.entries(v as Record<string, unknown>);
  const simple = entries.filter(([, x]) => !isComplex(x));
  const complex = entries.filter(([, x]) => isComplex(x));
  return (
    <div className="space-y-1.5">
      {simple.length > 0 && (
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {simple.map(([ek, ev]) => (
            <span key={ek} className="text-xs">
              <span className="text-foreground font-mono text-[11px]">
                {ek}
              </span>{" "}
              <span className="text-foreground font-medium">
                <Primitive k={ek} v={ev} />
              </span>
            </span>
          ))}
        </div>
      )}
      {complex.map(([ek, ev]) => (
        <div key={ek}>
          <p className="text-foreground font-mono text-[11px] mb-1">
            {ek}
          </p>
          <div className="pl-3 border-l border-border">
            <NestedValue k={ek} v={ev} />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Model id with its logo from /public in front. */
function ModelChip({ id, provider }: { id: string; provider?: string }) {
  const icon = modelIcon(id, provider);
  return (
    <span className="inline-flex items-center gap-1.5 min-w-0">
      {icon ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={icon.src}
          alt={icon.name}
          className={`size-4 shrink-0 ${icon.theme ?? ""}`}
        />
      ) : (
        <Cpu className="size-4 shrink-0 text-foreground" />
      )}
      <span className="font-mono text-foreground truncate">{id}</span>
    </span>
  );
}

const SOURCE_LABEL = {
  provider: "reported by provider",
  agent: "reported by agent",
  estimated: "estimated at market price",
} as const;

/** Shows what the run cost: a reported figure when there is one, else tokens x market price (labelled). */
function CostCard({ report }: { report: UsageReport }) {
  if (report.models.length === 0) return null;
  return (
    <div className="rounded-md border border-border bg-muted/30 p-3 space-y-2">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-[11px] text-foreground font-mono">cost</p>
        <p className="text-sm font-semibold text-foreground">
          {report.totalCostUsd !== undefined
            ? fmtNumber(report.totalCostUsd, "cost_usd")
            : "price unknown"}
          {report.estimated && (
            <span className="ml-2 text-[11px] font-normal text-foreground">
              estimated
            </span>
          )}
        </p>
      </div>
      <ul className="space-y-1">
        {report.models.map((m) => {
          const p = priceFor(m.id);
          return (
            <li
              key={m.id}
              className="text-[11px] text-foreground flex flex-wrap justify-between gap-x-3"
            >
              <ModelChip id={m.id} provider={m.provider} />
              <span>
                {m.totalTokens.toLocaleString()} tokens ·{" "}
                {m.costUsd !== undefined && m.costSource
                  ? `${fmtNumber(m.costUsd, "cost_usd")} (${SOURCE_LABEL[m.costSource]}${
                      m.costSource === "estimated" && p
                        ? `, $${p.input}/$${p.output} per 1M`
                        : ""
                    })`
                  : `no price listed for ${normalizeModelId(m.id)}`}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function TelemetryView({ data }: { data: Record<string, unknown> }) {
  // `framework` holds SDK internals (custom metrics); developers don't need it here.
  const entries = Object.entries(data).filter(([k]) => k !== "framework");
  const simple = entries.filter(([, v]) => !isComplex(v));
  const complex = entries.filter(([, v]) => isComplex(v));
  const report = analyzeUsage(data);
  const providerOfId = (id: string) =>
    report.models.find((m) => m.id === id)?.provider;
  return (
    <div className="p-4 space-y-5">
      <CostCard report={report} />
      {simple.length > 0 && (
        <dl className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {simple.map(([k, v]) => (
            <div
              key={k}
              className={`min-w-0 ${k === "model_used" ? "col-span-full" : ""}`}
            >
              <dt className="text-[11px] text-foreground font-mono truncate">
                {k}
              </dt>
              <dd className="text-xs font-medium text-foreground mt-0.5 break-words">
                {k === "model_used" && typeof v === "string" ? (
                  <span className="flex flex-wrap gap-x-4 gap-y-1">
                    {v
                      .split(",")
                      .map((id) => id.trim())
                      .filter(Boolean)
                      .map((id) => (
                        <ModelChip key={id} id={id} provider={providerOfId(id)} />
                      ))}
                  </span>
                ) : (
                  <Primitive k={k} v={v} />
                )}
              </dd>
            </div>
          ))}
        </dl>
      )}
      {complex.map(([k, v]) => (
        <div key={k} className="space-y-1.5">
          <p className="text-[11px] text-foreground font-mono">{k}</p>
          {k === "models" && Array.isArray(v) ? (
            <ul className="space-y-2">
              {v.map((m, i) => {
                const { id, ...rest } = (m ?? {}) as Record<string, unknown>;
                if (typeof id !== "string") {
                  return (
                    <li key={i} className="rounded-md border border-border p-3">
                      <NestedValue k={k} v={m} />
                    </li>
                  );
                }
                return (
                  <li
                    key={`${id}-${i}`}
                    className="rounded-md border border-border p-3 space-y-2 text-xs"
                  >
                    <ModelChip
                      id={id}
                      provider={
                        typeof rest.provider === "string"
                          ? rest.provider
                          : undefined
                      }
                    />
                    <NestedValue k={k} v={rest} />
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="rounded-md border border-border p-3">
              <NestedValue k={k} v={v} />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

type ResultTab = "events" | "output" | "telemetry";

export interface DetectedModel {
  id: string;
  provider?: string;
  totalTokens: number;
  costUsd?: number;
}

export function DryRunStep({
  url,
  inputSchema,
  agentName,
  initialValues,
  onValuesChange,
  onUsageCheck,
}: {
  url: string;
  inputSchema?: JsonObj;
  agentName?: string;
  /** Previously typed form values (restored after a reload). */
  initialValues?: Record<string, unknown>;
  onValuesChange?: (values: Record<string, unknown>) => void;
  /** Called with true only after a completed run that reported a model AND tokens. */
  onUsageCheck?: (
    ok: boolean,
    info?: { costUsd?: number; models: DetectedModel[] },
  ) => void;
}) {
  const props = inputSchema?.properties as Record<string, JsonObj> | undefined;
  const required = new Set<string>(inputSchema?.required ?? []);
  const fields = props ? Object.entries(props) : [];
  // The main question/prompt field is always visible; everything else optional is tucked away.
  const PRIMARY =
    /^(prompt|query|message|question|input|text|task|instruction|q)$/i;
  const companionKeys = props ? companionKeysOf(props) : new Set<string>();
  let requiredFields = fields.filter(
    ([k]) => !companionKeys.has(k) && (required.has(k) || PRIMARY.test(k)),
  );
  if (requiredFields.length === 0) {
    const firstString = fields.find(
      ([k, p]) =>
        p.type === "string" && !companionKeys.has(k) && !isFileField(k, p),
    );
    if (firstString) requiredFields = [firstString];
  }
  const shown = new Set(requiredFields.map(([k]) => k));
  const optionalFields = fields.filter(
    ([k]) => !shown.has(k) && !companionKeys.has(k),
  );

  const [values, setValues] = useState<Record<string, unknown>>(() => ({
    ...Object.fromEntries(fields.map(([k, p]) => [k, defaultFor(p)])),
    ...initialValues,
  }));

  useEffect(() => {
    // Uploaded files (base64) are too big for localStorage, so only plain values are kept
    onValuesChange?.(
      Object.fromEntries(
        Object.entries(values).filter(
          ([, v]) => v === null || typeof v !== "object",
        ),
      ),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [values]);
  const [rawJson, setRawJson] = useState("{}");
  const [testToken, setTestToken] = useState<string | null>(null);
  const [aiPromptOpen, setAiPromptOpen] = useState(false);
  const [state, setState] = useState<RunState>("idle");
  const [formError, setFormError] = useState("");
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [deltaText, setDeltaText] = useState("");
  const [deltaCount, setDeltaCount] = useState(0);
  const [tab, setTab] = useState<ResultTab>("events");
  const startedAt = useRef(0);

  // Keys are stored hashed, so the pasted key is checked by its last 4 chars.

  const final = events.find(
    (e) => e.kind === "completed" || e.kind === "failed",
  );
  const completed = final?.kind === "completed" ? final : undefined;
  const failed = final?.kind === "failed" ? final : undefined;
  const liveEvents = events.filter(
    (e) => e.kind !== "completed" && e.kind !== "failed",
  );
  const eventCount =
    liveEvents.filter((e) => e.kind !== "info").length + (deltaCount ? 1 : 0);
  const telemetry = completed?.telemetry;
  const hasTelemetry = !!telemetry && Object.keys(telemetry).length > 0;
  const running = state === "running";
  const usageReport = analyzeUsage(telemetry);
  const usageMissing = !!completed && !usageReport.ok;

  useEffect(() => {
    // Before the first run, stay silent so a restored result isn't wiped on mount
    if (state === "idle") return;
    const ok = !!completed && usageReport.ok;
    onUsageCheck?.(
      ok,
      ok
        ? {
            costUsd: usageReport.totalCostUsd,
            models: usageReport.models.map((m) => ({
              id: m.id,
              provider: m.provider ?? providerOf(m.id),
              totalTokens: m.totalTokens,
              costUsd: m.costUsd,
            })),
          }
        : undefined,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, completed, usageReport.ok, usageReport.totalCostUsd]);

  const canRun = !running && !!testToken;

  const run = async () => {
    const built = buildInput(inputSchema, values, rawJson);
    if (built.error) {
      setFormError(built.error);
      return;
    }
    setFormError("");
    setEvents([]);
    setDeltaText("");
    setDeltaCount(0);
    setTab("events");
    setState("running");
    startedAt.current = Date.now();

    try {
      const res = await fetch("/api/agents/dry-run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          url,
          input: built.input,
          token: testToken,
        }),
      });
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Dry run could not start.");
      }

      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      let ended: RunState = "failed";

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) !== -1) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          const ev = JSON.parse(line) as RunEvent;
          if (ev.kind === "delta") {
            setDeltaText((t) => t + ev.label);
            setDeltaCount((c) => c + 1);
            continue;
          }
          if (ev.kind === "completed") ended = "completed";
          setEvents((prev) => [...prev, ev]);
        }
      }
      setState(ended);
    } catch (e) {
      setEvents((prev) => [
        ...prev,
        {
          kind: "failed",
          error: {
            code: "REQUEST_FAILED",
            message: e instanceof Error ? e.message : "Dry run failed.",
          },
          ts: Date.now(),
        },
      ]);
      setState("failed");
    }
  };

  const renderField = ([key, p]: [string, JsonObj]) => {
    const isBool = p.type === "boolean";
    return (
      <div
        key={key}
        className={
          isBool ? "flex items-center justify-between gap-4" : "space-y-1.5"
        }
      >
        <div className="min-w-0">
          <Label className="text-xs font-mono">
            {key}
            {required.has(key) && (
              <span className="text-destructive ml-0.5">*</span>
            )}
          </Label>
          {p.description && (
            <p className="text-[11px] text-foreground mt-0.5">
              {p.description}
            </p>
          )}
        </div>
        <FieldInput
          name={key}
          schema={p}
          value={values[key]}
          disabled={running}
          onChange={(v) => setValues((s) => ({ ...s, [key]: v }))}
        />
      </div>
    );
  };

  const overall: Tone =
    state === "running"
      ? "running"
      : state === "completed"
        ? "ok"
        : state === "failed"
          ? "fail"
          : "idle";
  const streamTone: Tone =
    eventCount > 0 ? "ok" : running ? "running" : failed ? "fail" : "idle";
  const doneTone: Tone = running
    ? "running"
    : completed
      ? "ok"
      : failed
        ? "fail"
        : "idle";
  const teleTone: Tone = running
    ? "running"
    : hasTelemetry
      ? "ok"
      : completed
        ? "fail"
        : "idle";

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-base font-semibold text-foreground flex items-center gap-2">
            <div className="size-7 rounded-md border border-zinc-300 dark:border-zinc-700 bg-muted flex items-center justify-center shrink-0 shadow!">
              <Play className="size-4 text-foreground fill-current" />
            </div>
            <span>Dry run</span>
          </h3>
          <p className="text-sm text-foreground mt-1.5">
            Run{" "}
            {agentName ? (
              <span className="text-foreground font-medium">{agentName}</span>
            ) : (
              "your agent"
            )}{" "}
            once to confirm it responds, streams events and reports telemetry.
          </p>
          <div className="mt-3 flex items-start gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2.5">
            <Info className="size-3.5 text-foreground shrink-0 mt-0.5" />
            <p className="text-xs text-foreground leading-relaxed">
              <span className="font-medium text-foreground">Note:</span> Dry run
              should be quick and is only for testing your agent&apos;s streams
              and viewing telemetry. It will time out after{" "}
              <span className="font-medium text-foreground">
                {DRY_RUN_TIMEOUT_SECONDS} seconds.
              </span>
            </p>
          </div>
        </div>

        <div className="shrink-0">
          <RainbowButton
            type="button"
            size="sm"
            onClick={() => setAiPromptOpen(true)}
            className="h-8 rounded-md px-3 text-xs font-medium cursor-pointer"
          >
            Register with AI
          </RainbowButton>
        </div>
      </div>

      {/* ── Test token ── */}
      <section className="space-y-3">
        <SectionTitle icon={KeyRound}>Test token</SectionTitle>
        <p className="text-xs text-foreground -mt-1">
          A short-lived token for quick testing by you only. It can&apos;t
          process buyer requests and expires on its own.
        </p>
        <TestTokenPanel onTokenChange={setTestToken} disabled={running} />
      </section>

      {/* ── Input ── */}
      <section className="space-y-3">
        <SectionTitle icon={SlidersHorizontal}>Input</SectionTitle>
        <div className="rounded-lg border border-border p-4 space-y-4">
          {fields.length === 0 ? (
            <div className="space-y-1.5">
              <Label className="text-xs">JSON input</Label>
              <Textarea
                value={rawJson}
                onChange={(e) => setRawJson(e.target.value)}
                disabled={running}
                className="font-mono text-xs min-h-24"
              />
              <p className="text-[11px] text-foreground">
                No input schema declared, so any JSON is accepted.
              </p>
            </div>
          ) : (
            <>
              {requiredFields.map(renderField)}
              {optionalFields.length > 0 && (
                <Collapsible className="group/opt">
                  <CollapsibleTrigger className="group/trig flex w-full items-center justify-between rounded-md bg-muted/60 hover:bg-muted px-3 py-2 text-xs font-medium text-foreground transition-colors cursor-pointer">
                    <span>Optional fields ({optionalFields.length})</span>
                    <ChevronDown className="size-3.5 text-foreground transition-transform group-data-[panel-open]/trig:rotate-180" />
                  </CollapsibleTrigger>
                  <CollapsibleContent className="pt-4 space-y-4">
                    {optionalFields.map(renderField)}
                  </CollapsibleContent>
                </Collapsible>
              )}
            </>
          )}

          {formError && (
            <p className={`text-xs flex items-center gap-1.5 ${toneText.fail}`}>
              <CircleAlert className="size-3.5" />
              {formError}
            </p>
          )}
        </div>

        <Button type="button" size="sm" onClick={run} disabled={!canRun}>
          {running ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Play className="size-3.5" />
          )}
          {running
            ? "Running…"
            : state === "idle"
              ? "Run dry run"
              : "Run again"}
        </Button>
      </section>

      {/* ── Result: one panel ── */}
      {state !== "idle" && (
        <section className="space-y-3">
          <SectionTitle
            icon={Activity}
            aside={
              <span
                className={`inline-flex items-center gap-1.5 text-xs font-medium ${toneText[overall]}`}
              >
                <ToneIcon tone={overall} />
                {overall === "running"
                  ? "Running"
                  : overall === "ok"
                    ? "Completed"
                    : "Failed"}
                {completed?.durationMs ? (
                  <span className="text-foreground font-normal">
                    · {completed.durationMs} ms
                  </span>
                ) : null}
              </span>
            }
          >
            Result
          </SectionTitle>

          <div className="rounded-lg border border-border overflow-hidden">
            <div className="flex flex-wrap gap-x-6 gap-y-2 px-4 py-3 border-b border-border bg-muted/40 text-xs">
              {(
                [
                  [
                    "Streaming",
                    streamTone,
                    eventCount ? `${eventCount} events` : "",
                  ],
                  ["Completed", doneTone, ""],
                  ["Telemetry", teleTone, ""],
                ] as const
              ).map(([label, tone, note]) => (
                <span
                  key={label}
                  className="inline-flex items-center gap-1.5 text-foreground"
                >
                  <ToneIcon tone={tone} />
                  {label}
                  {note && (
                    <span className="text-foreground">· {note}</span>
                  )}
                </span>
              ))}
            </div>

            {failed && (
              <div className="px-4 py-3 border-b border-border flex items-start gap-2.5">
                <CircleAlert
                  className={`size-4 shrink-0 mt-0.5 ${toneText.fail}`}
                />
                <div className="text-xs min-w-0">
                  <p className={`font-medium ${toneText.fail}`}>
                    {failed.error.code ?? "Run failed"}
                  </p>
                  <p className="text-foreground mt-0.5 break-words">
                    {failed.error.message}
                  </p>
                  {failed.error.code?.startsWith("AUTH") && (
                    <p className="text-foreground mt-1">
                      Make sure your agent runs SDK 1.1.3 or newer and has
                      CATELOG_PUBLIC_KEY set, then generate a fresh token.
                    </p>
                  )}
                </div>
              </div>
            )}

            {usageMissing && (
              <div className="px-4 py-2.5 border-b border-destructive/30 bg-destructive/10 flex items-start gap-2 text-xs text-destructive">
                <CircleAlert className="size-3.5 shrink-0 mt-0.5" />
                <p>
                  Marketplace is not able to get your trace / insights. See the{" "}
                  <Link href="/docs" className="underline font-medium">
                    docs
                  </Link>{" "}
                  to set up the SDK correctly and try again.
                </p>
              </div>
            )}

            <div className="flex gap-1 px-2 pt-2 border-b border-border">
              {(["events", "output", "telemetry"] as ResultTab[]).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTab(t)}
                  className={`px-3 py-1.5 text-xs rounded-t-md capitalize transition-colors cursor-pointer ${
                    tab === t
                      ? "bg-muted text-foreground font-medium"
                      : "text-foreground hover:text-foreground"
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>

            <div className="max-h-72 overflow-auto">
              {tab === "events" && (
                <ul className="divide-y divide-border">
                  {liveEvents.length === 0 && deltaCount === 0 && (
                    <li className="px-4 py-3 text-xs text-muted-foreground flex items-center gap-2">
                      {running ? (
                        <>
                          <Loader2
                            className={`size-3.5 animate-spin ${toneText.running}`}
                          />
                          Waiting for the first event…
                        </>
                      ) : (
                        "No events were received."
                      )}
                    </li>
                  )}
                  {liveEvents.map((e, i) => (
                    <li
                      key={i}
                      className="px-4 py-2 flex items-start gap-3 text-xs"
                    >
                      <span className="font-mono text-[11px] text-muted-foreground w-12 shrink-0 pt-px">
                        +{((e.ts - startedAt.current) / 1000).toFixed(1)}s
                      </span>
                      <span className="font-mono text-[11px] text-muted-foreground w-16 shrink-0 pt-px">
                        {e.kind}
                      </span>
                      <span className="text-foreground min-w-0 break-words">
                        {/* @ts-ignore */}
                        {e.label}
                        {e.kind === "progress" && e.percent !== undefined && (
                          <span className="text-muted-foreground">
                            {" "}
                            · {e.percent}%
                          </span>
                        )}
                      </span>
                    </li>
                  ))}
                  {deltaCount > 0 && (
                    <li className="px-4 py-2 text-xs">
                      <p className="text-muted-foreground mb-1.5">
                        {deltaCount} text chunk{deltaCount === 1 ? "" : "s"}{" "}
                        streamed
                      </p>
                      <pre className="font-mono text-[11px] whitespace-pre-wrap break-words text-foreground/80">
                        {deltaText}
                      </pre>
                    </li>
                  )}
                </ul>
              )}

              {tab === "output" &&
                (completed ? (
                  <pre className="p-4 text-[11px] font-mono leading-relaxed whitespace-pre-wrap break-words text-foreground/80">
                    {JSON.stringify(completed.output, null, 2)}
                  </pre>
                ) : (
                  <p className="p-4 text-xs text-muted-foreground">
                    {running
                      ? "Output appears when the run completes."
                      : "No output. The run did not complete."}
                  </p>
                ))}

              {tab === "telemetry" &&
                (hasTelemetry ? (
                  <TelemetryView data={telemetry as Record<string, unknown>} />
                ) : (
                  <p className="p-4 text-xs text-foreground">
                    {running
                      ? "Telemetry appears when the run completes."
                      : completed
                        ? "No telemetry returned. Report usage from execute() to surface tokens, model and cost."
                        : "No telemetry. The run did not complete."}
                  </p>
                ))}
            </div>
          </div>
        </section>
      )}

      <AgentPromptDialog open={aiPromptOpen} onOpenChange={setAiPromptOpen} />
    </div>
  );
}
