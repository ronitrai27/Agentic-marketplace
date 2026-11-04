"use client";

import React from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import { CheckCircle2, CircleAlert, Lock, WifiOff, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { SchemaForm, buildInput, fieldsFromSchema, initialValues, type FormValues } from "./schema-form";

const HOLD_TTL_MS = 15 * 60_000;
const ACTIVE = new Set(["awaiting_input", "queued", "running"]);

const fmtCredits = (n: number) => `${Number.isInteger(n) ? n : n.toFixed(2).replace(/0$/, "")} credits`;

function clock(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

function useNow(active: boolean) {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

function useOnline() {
  const [online, setOnline] = React.useState(true);
  React.useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  return online;
}

const STATUS: Record<string, { label: string; tone: string }> = {
  awaiting_input: { label: "Waiting for your input", tone: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300" },
  queued: { label: "Queued", tone: "bg-muted text-muted-foreground" },
  running: { label: "Running", tone: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300" },
  succeeded: { label: "Completed", tone: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300" },
  failed: { label: "Failed", tone: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300" },
  cancelled: { label: "Cancelled", tone: "bg-muted text-muted-foreground" },
};

function parse(json: string): any {
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

/** Long strings (uploaded files as base64) would flood the panel: show their length instead. */
function clip(value: unknown): unknown {
  if (typeof value === "string") return value.length > 160 ? `${value.slice(0, 80)}… (${value.length.toLocaleString()} characters)` : value;
  if (Array.isArray(value)) return value.map(clip);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, clip(v)]));
  return value;
}

type RunEvent = { seq: number; type: string; dataJson: string; at: number };

function Row({ at, base, children }: { at: number; base: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-3 text-xs">
      <span className="w-12 shrink-0 pt-0.5 text-right font-mono text-[10px] tabular-nums text-muted-foreground">
        +{((at - base) / 1000).toFixed(1)}s
      </span>
      <div className="min-w-0 flex-1">{children}</div>
    </li>
  );
}

function EventRow({ event, base }: { event: RunEvent; base: number }) {
  const d = parse(event.dataJson) ?? {};
  const { type } = event;

  let body: React.ReactNode;
  if (type === "task.delta") {
    body = <pre className="whitespace-pre-wrap rounded-lg bg-muted/60 p-2.5 font-mono text-xs leading-relaxed">{String(d.content ?? "")}</pre>;
  } else if (type === "task.progress") {
    body = (
      <p>
        <span className="font-medium">Progress {typeof d.percent === "number" ? `${Math.round(d.percent)}%` : ""}</span>
        {d.message ? <span className="text-muted-foreground"> · {String(d.message)}</span> : null}
      </p>
    );
  } else if (type === "task.status") {
    body = <p className="text-muted-foreground">Agent status: <span className="text-foreground">{String(d.status)}</span></p>;
  } else if (type === "task.activity") {
    body = (
      <p>
        <span className="font-medium">{String(d.activity_type ?? "activity")}</span>
        {d.data ? <span className="text-muted-foreground"> · {JSON.stringify(d.data).slice(0, 160)}</span> : null}
      </p>
    );
  } else if (type === "health") {
    body = d.ok ? (
      <p className="text-emerald-600">Agent server is healthy{typeof d.latencyMs === "number" ? ` · ${d.latencyMs} ms` : ""}</p>
    ) : (
      <p className="text-amber-600">Agent server did not answer its health check</p>
    );
  } else if (type === "schema.check") {
    body = d.valid ? (
      <p className="flex items-center gap-1.5 text-emerald-600">
        <CheckCircle2 className="size-3.5" /> Output matches the agent's schema
      </p>
    ) : (
      <p className="flex items-center gap-1.5 text-red-600">
        <XCircle className="size-3.5" /> Output broke the schema: {String(d.problem ?? "")}
      </p>
    );
  } else if (type === "task.completed") {
    const out = d.truncated ? d.preview : JSON.stringify(d.output, null, 2);
    body = (
      <div className="space-y-1.5">
        <p className="font-medium text-emerald-600">Agent finished</p>
        <pre className="max-h-80 overflow-auto rounded-lg bg-muted/60 p-2.5 font-mono text-xs">{out}</pre>
        {d.truncated && <p className="text-[11px] text-muted-foreground">Long output, showing the start only.</p>}
      </div>
    );
  } else if (type === "task.failed") {
    body = <p className="text-red-600">Agent failed: {String(d.error?.message ?? "unknown error")}</p>;
  } else if (type === "run.note") {
    body = <p className={d.level === "error" ? "text-red-600" : "text-muted-foreground"}>{String(d.message ?? "")}</p>;
  } else {
    body = (
      <p className="text-muted-foreground">
        <span className="font-mono text-foreground">{type}</span> {JSON.stringify(d).slice(0, 160)}
      </p>
    );
  }
  return (
    <Row at={event.at} base={base}>
      {body}
    </Row>
  );
}

function RunBody({ runId, onClose }: { runId: Id<"runs">; onClose: () => void }) {
  const run = useQuery(api.runs.get, { runId });
  const events = useQuery(api.runs.events, { runId });
  const start = useAction(api.temporal.start);
  const cancelAwaiting = useMutation(api.runs.cancelAwaiting);

  const online = useOnline();
  const active = !!run && ACTIVE.has(run.status);
  const now = useNow(active);

  const fields = React.useMemo(() => (run ? fieldsFromSchema(run.agent.inputSchemaJson) : []), [run?.agent.inputSchemaJson]);
  const [values, setValues] = React.useState<FormValues | null>(null);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [sendError, setSendError] = React.useState<string | null>(null);
  const [sending, setSending] = React.useState(false);

  const fileNames = React.useMemo(
    () => new Set(fields.flatMap((f) => (f.kind === "file" ? [f.name, ...(f.filenameField ? [f.filenameField] : [])] : []))),
    [fields],
  );

  // Draft survives a refresh: typed values are kept per run until the input is sent
  const draftKey = `run-draft:${runId}`;
  React.useEffect(() => {
    if (!run || values) return;
    let saved: FormValues | null = null;
    try {
      saved = JSON.parse(localStorage.getItem(draftKey) ?? "null");
    } catch {
      /* no saved draft */
    }
    setValues({ ...initialValues(fields), ...(saved ?? {}) });
  }, [run, values, fields, draftKey]);
  React.useEffect(() => {
    if (!values) return;
    try {
      localStorage.setItem(draftKey, JSON.stringify(values));
    } catch {
      /* storage unavailable, the draft just won't persist */
    }
  }, [values, draftKey, fileNames]);

  const logRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
  }, [events?.length]);

  if (run === undefined) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Spinner className="size-6" />
      </div>
    );
  }
  if (run === null) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
        <CircleAlert className="size-6 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">This run could not be found.</p>
        <Button variant="outline" onClick={onClose}>
          Close
        </Button>
      </div>
    );
  }

  const status = STATUS[run.status] ?? STATUS.queued;
  const base = run.startedAt ?? run.createdAt;
  const elapsed = (run.finishedAt ?? now) - base;
  const limitMs = run.timeoutSeconds * 1000;

  async function send() {
    if (!values) return;
    const built = buildInput(fields, values);
    if (built.errors) {
      setErrors(built.errors);
      return;
    }
    setErrors({});
    setSendError(null);
    setSending(true);
    try {
      await start({ runId, inputJson: JSON.stringify(built.input) });
      try {
        localStorage.removeItem(draftKey);
      } catch {
        /* ignore */
      }
    } catch (err) {
      const data = err instanceof ConvexError ? (err.data as { message?: string }) : null;
      setSendError(data?.message ?? "Could not start the run. Please try again.");
    } finally {
      setSending(false);
    }
  }

  async function cancel() {
    try {
      await cancelAwaiting({ runId });
      try {
        localStorage.removeItem(draftKey);
      } catch {
        /* ignore */
      }
    } finally {
      onClose();
    }
  }

  return (
    <>
      <SheetHeader className="border-b border-border">
        <SheetTitle className="text-lg">{run.agent.name}</SheetTitle>
        <SheetDescription className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-medium ${status.tone}`}>
            {run.status === "running" && <span className="size-1.5 animate-pulse rounded-full bg-current" />}
            {status.label}
          </span>
          {run.status === "awaiting_input" ? (
            <span className="tabular-nums">Hold expires in {clock(run.createdAt + HOLD_TTL_MS - now)}</span>
          ) : (
            <span className="tabular-nums">
              {clock(elapsed)} <span className="text-muted-foreground/70">/ {clock(limitMs)} limit</span>
            </span>
          )}
          {run.holdCredits !== null && (
            <span className="inline-flex items-center gap-1">
              <Lock className="size-3" />
              {run.holdStatus === "held"
                ? `${fmtCredits(run.holdCredits)} held`
                : run.holdStatus === "settled"
                  ? `${fmtCredits(run.chargedCredits ?? 0)} charged`
                  : "Hold released, nothing charged"}
            </span>
          )}
        </SheetDescription>
      </SheetHeader>

      {!online && (
        <div className="mx-4 flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-300">
          <WifiOff className="mt-0.5 size-3.5 shrink-0" />
          You are offline. The run keeps going on our servers, and this panel catches up when you are back.
        </div>
      )}

      <div ref={logRef} className="flex-1 space-y-5 overflow-y-auto px-4 pb-4">
        {run.status === "awaiting_input" && values ? (
          <section className="space-y-4">
            <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Input</h3>
            <SchemaForm
              fields={fields}
              values={values}
              errors={errors}
              disabled={sending}
              onChange={(name, value) => setValues((v) => ({ ...(v ?? {}), [name]: value }))}
            />
            {sendError && <p className="text-xs text-red-600">{sendError}</p>}
          </section>
        ) : (
          <>
            {(run.inputJson || run.inputLarge) && (
              <details className="rounded-lg border border-border px-3 py-2 text-xs">
                <summary className="cursor-pointer font-medium text-muted-foreground">Input you sent</summary>
                {run.inputJson ? (
                  <pre className="mt-2 max-h-48 overflow-auto font-mono">{JSON.stringify(clip(parse(run.inputJson)), null, 2)}</pre>
                ) : (
                  <p className="mt-2 text-muted-foreground">Included uploaded files. They are deleted as soon as the run ends.</p>
                )}
              </details>
            )}
            <section className="space-y-3">
              <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Live events</h3>
              {events && events.length > 0 ? (
                <ul className="space-y-2.5">
                  {events.map((e) => (
                    <EventRow key={e.seq} event={e} base={base} />
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-muted-foreground">
                  {active ? "Waiting for the agent to report in…" : "No events were recorded."}
                </p>
              )}
              {run.error && (
                <p className="flex items-start gap-1.5 rounded-lg bg-red-50 p-2.5 text-xs text-red-700 dark:bg-red-950 dark:text-red-300">
                  <XCircle className="mt-0.5 size-3.5 shrink-0" />
                  {run.error.message}
                </p>
              )}
            </section>
          </>
        )}
      </div>

      <SheetFooter className="border-t border-border sm:flex-row sm:justify-end">
        {run.status === "awaiting_input" ? (
          <>
            <Button variant="outline" onClick={cancel} disabled={sending}>
              Cancel &amp; release hold
            </Button>
            <Button onClick={send} disabled={sending || !values}>
              {sending && <Spinner className="mr-1" />}
              Send
            </Button>
          </>
        ) : (
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        )}
      </SheetFooter>
    </>
  );
}

class Boundary extends React.Component<{ children: React.ReactNode; onClose: () => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
        <CircleAlert className="size-6 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">This run could not be opened.</p>
        <Button variant="outline" onClick={this.props.onClose}>
          Close
        </Button>
      </div>
    );
  }
}

/** Right-hand panel for one run. Everything shown comes from Convex, so a reload or a dropped connection loses nothing. */
export function RunSheet({ runId, onClose }: { runId: string; onClose: () => void }) {
  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="w-full gap-0 sm:max-w-xl">
        <Boundary onClose={onClose}>
          <RunBody runId={runId as Id<"runs">} onClose={onClose} />
        </Boundary>
      </SheetContent>
    </Sheet>
  );
}
