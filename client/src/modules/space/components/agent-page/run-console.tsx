"use client";

import React from "react";
import { Check, ChevronDown, Copy } from "lucide-react";
import { toast } from "sonner";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  downloadDocx,
  downloadPdf,
  outputToMarkdown,
} from "@/lib/export-output";
import { Button } from "@/components/ui/button";

export type RunEvent = {
  seq: number;
  type: string;
  dataJson: string;
  at: number;
};

function parse(json: string): any {
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

type Tone = "info" | "ok" | "warn" | "err" | "muted" | "tool";

const TONE: Record<Tone, { tag: string; text: string; bar: string }> = {
  info: {
    tag: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300",
    text: "text-foreground",
    bar: "bg-blue-500",
  },
  ok: {
    tag: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
    text: "text-emerald-700 dark:text-emerald-300",
    bar: "bg-emerald-500",
  },
  warn: {
    tag: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
    text: "text-amber-700 dark:text-amber-300",
    bar: "bg-amber-500",
  },
  err: {
    tag: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
    text: "text-red-700 dark:text-red-300",
    bar: "bg-red-500",
  },
  muted: {
    tag: "bg-muted text-muted-foreground",
    text: "text-muted-foreground",
    bar: "bg-neutral-300 dark:bg-neutral-700",
  },
  tool: {
    tag: "bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-700 dark:text-violet-300",
    text: "text-foreground",
    bar: "bg-violet-500",
  },
};

type Line = {
  tag: string;
  tone: Tone;
  body: React.ReactNode;
  extra?: React.ReactNode;
};

function toLine(e: RunEvent): Line {
  const d = parse(e.dataJson) ?? {};
  switch (e.type) {
    case "task.progress": {
      const pct = typeof d.percent === "number" ? Math.round(d.percent) : null;
      return {
        tag: "PROGRESS",
        tone: "info",
        body: (
          <span className="flex items-center gap-2">
            <span className="tabular-nums text-blue-600 dark:text-blue-400">
              {pct !== null ? `${String(pct).padStart(3, " ")}%` : "—"}
            </span>
            {pct !== null && (
              <span className="h-1 w-16 shrink-0 overflow-hidden rounded-full bg-muted">
                <span
                  className="block h-full rounded-full bg-blue-500"
                  style={{ width: `${pct}%` }}
                />
              </span>
            )}
            {d.message ? (
              <span className="text-muted-foreground">{String(d.message)}</span>
            ) : null}
          </span>
        ),
      };
    }
    case "task.activity": {
      const name = String(d.activity_type ?? "activity");
      const payload = d.data ? JSON.stringify(d.data) : "";
      return {
        tag: "TOOL",
        tone: "tool",
        body: (
          <span>
            <span className="font-semibold text-violet-700 dark:text-violet-300">
              {name}
            </span>
            {payload && (
              <span className="ml-2 break-all text-muted-foreground">
                {payload.length > 220 ? `${payload.slice(0, 220)}…` : payload}
              </span>
            )}
          </span>
        ),
      };
    }
    case "task.status":
      return {
        tag: "STATUS",
        tone: "muted",
        body: (
          <span>
            agent status →{" "}
            <span className="text-foreground">{String(d.status)}</span>
          </span>
        ),
      };
    case "task.delta":
      return {
        tag: "OUTPUT",
        tone: "info",
        body: (
          <span className="whitespace-pre-wrap text-foreground">
            {String(d.content ?? "")}
          </span>
        ),
      };
    case "health":
      return d.ok
        ? {
            tag: "HEALTH",
            tone: "ok",
            body: (
              <span>
                agent server healthy
                {typeof d.latencyMs === "number" ? ` · ${d.latencyMs} ms` : ""}
              </span>
            ),
          }
        : {
            tag: "HEALTH",
            tone: "warn",
            body: <span>agent server did not answer its health check</span>,
          };
    case "schema.check":
      return d.valid
        ? {
            tag: "SCHEMA",
            tone: "ok",
            body: <span>output matches the agent&apos;s schema</span>,
          }
        : {
            tag: "SCHEMA",
            tone: "err",
            body: (
              <span>output broke the schema: {String(d.problem ?? "")}</span>
            ),
          };
    case "task.completed":
      return {
        tag: "DONE",
        tone: "ok",
        body: <span>agent finished — see the Output tab</span>,
      };
    case "task.failed":
      return {
        tag: "FAILED",
        tone: "err",
        body: <span>{String(d.error?.message ?? "unknown error")}</span>,
      };
    case "run.note":
      return {
        tag: d.level === "error" ? "ERROR" : "NOTE",
        tone: d.level === "error" ? "err" : "muted",
        body: <span>{String(d.message ?? "")}</span>,
      };
    default:
      return {
        tag: e.type.toUpperCase().slice(0, 8),
        tone: "muted",
        body: (
          <span className="break-all">{JSON.stringify(d).slice(0, 200)}</span>
        ),
      };
  }
}

/** Live trace of a run: a clean timeline that fills the available height. */
export function RunConsole({
  events,
  base,
  live,
  runLabel,
  error,
}: {
  events: RunEvent[] | undefined;
  base: number;
  live: boolean;
  runLabel: string;
  error?: string | null;
}) {
  const ref = React.useRef<HTMLDivElement>(null);
  // The answer itself lives in the Output tab, so streamed output chunks are not repeated in the trace
  const shown = events?.filter((e) => e.type !== "task.delta");
  React.useEffect(() => {
    if (live)
      ref.current?.scrollTo({
        top: ref.current.scrollHeight,
        behavior: "smooth",
      });
  }, [shown?.length, live]);
  const count = shown?.length ?? 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-background">
      <div className="flex items-center gap-2 border-b border-border bg-muted/40 px-3.5 py-2.5">
        <span className="truncate text-xs font-medium text-foreground">
          {runLabel}
        </span>
        <span className="ml-auto inline-flex shrink-0 items-center gap-1.5 text-[11px] text-muted-foreground">
          {live ? (
            <>
              <span className="size-1.5 animate-pulse rounded-full bg-emerald-500" />{" "}
              Live
            </>
          ) : (
            "Ended"
          )}
          <span>·</span>
          <span className="tabular-nums">
            {count} {count === 1 ? "event" : "events"}
          </span>
        </span>
      </div>

      <div ref={ref} className="min-h-0 flex-1 overflow-y-auto">
        {count === 0 ? (
          <p className="px-4 py-8 text-center text-xs text-muted-foreground">
            {live
              ? "Waiting for the agent to report in…"
              : "No events were recorded."}
          </p>
        ) : (
          <ol className="divide-y divide-border/70">
            {shown!.map((e) => {
              const l = toLine(e);
              const t = TONE[l.tone];
              return (
                <li
                  key={e.seq}
                  className="flex items-start gap-3 px-3.5 py-2.5 text-xs hover:bg-muted/30"
                >
                  <span className="w-11 shrink-0 pt-0.5 text-right font-mono text-[10px] tabular-nums text-muted-foreground">
                    +{((e.at - base) / 1000).toFixed(1)}s
                  </span>
                  <span className="w-[4.5rem] shrink-0">
                    <span
                      className={`inline-block rounded-md px-1.5 py-0.5 text-[9.5px] font-semibold tracking-wide ${t.tag}`}
                    >
                      {l.tag}
                    </span>
                  </span>
                  <span className={`min-w-0 flex-1 leading-relaxed ${t.text}`}>
                    {l.body}
                  </span>
                </li>
              );
            })}
          </ol>
        )}
        {error && (
          <p className="border-t border-red-200 bg-red-50 px-3.5 py-2.5 text-xs text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
            <span className="mr-2 font-semibold">Error</span>
            {error}
          </p>
        )}
      </div>
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = React.useState(false);
  return (
    <Button
      variant="ghost"
      size="sm"
      className="h-7 gap-1 px-2 text-xs"
      onClick={() => {
        navigator.clipboard?.writeText(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        });
      }}
    >
      {done ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      {done ? "Copied" : "Copy"}
    </Button>
  );
}

const isText = (v: unknown): v is string => typeof v === "string";

function Markdown({ children }: { children: string }) {
  return (
    <div className="flex flex-col gap-3 text-sm leading-relaxed text-foreground">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          strong: ({ children }) => (
            <strong className="font-semibold">{children}</strong>
          ),
          a: ({ children, href }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary underline underline-offset-2"
            >
              {children}
            </a>
          ),
          ul: ({ children }) => (
            <ul className="ml-5 list-disc space-y-1">{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className="ml-5 list-decimal space-y-1">{children}</ol>
          ),
          h1: ({ children }) => (
            <h3 className="text-lg font-semibold">{children}</h3>
          ),
          h2: ({ children }) => (
            <h3 className="text-base font-semibold">{children}</h3>
          ),
          h3: ({ children }) => (
            <h4 className="text-sm font-semibold">{children}</h4>
          ),
          blockquote: ({ children }) => (
            <blockquote className="border-l-2 border-border pl-3 text-muted-foreground">
              {children}
            </blockquote>
          ),
          hr: () => <hr className="border-border" />,
          code: ({ className, children }) =>
            className ? (
              <code className={`${className} font-mono text-xs`}>
                {children}
              </code>
            ) : (
              <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
                {children}
              </code>
            ),
          pre: ({ children }) => (
            <pre className="overflow-x-auto rounded-lg border border-border bg-muted/50 p-3">
              {children}
            </pre>
          ),
          table: ({ children }) => (
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full border-collapse text-left text-sm">
                {children}
              </table>
            </div>
          ),
          thead: ({ children }) => (
            <thead className="bg-muted/50">{children}</thead>
          ),
          th: ({ children }) => (
            <th className="border-b border-border px-3 py-2 font-medium">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="border-b border-border px-3 py-2">{children}</td>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}

/** "Download as" with the PDF and DOC icons; clicking opens the two download buttons below it. */
export function DownloadAs({
  markdown,
  title,
  filename,
}: {
  markdown: string;
  title: string;
  filename: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState<"pdf" | "doc" | null>(null);
  const run = async (kind: "pdf" | "doc") => {
    setBusy(kind);
    try {
      await (kind === "pdf" ? downloadPdf : downloadDocx)(
        markdown,
        title,
        filename,
      );
      toast.success(
        kind === "pdf" ? "Downloaded PDF file" : "Downloaded DOC file",
      );
    } catch (err: any) {
      toast.error(
        err?.message || `Failed to download ${kind.toUpperCase()} file`,
      );
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="relative">
      <Button
        variant="outline"
        size="sm"
        className="h-8 bg-neutral-50! gap-2 px-2.5 text-xs"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        Download as
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/pdf.svg"
          alt="PDF"
          className="size-7 shrink-0 object-contain"
        />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/doc.svg"
          alt="DOC"
          className="size-5 shrink-0 object-contain"
        />
        <ChevronDown
          className={`size-3.5 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </Button>
      {open && (
        <div className="absolute right-0 top-full z-30 mt-1.5 flex gap-2 rounded-lg border border-border bg-popover p-1.5 shadow-md">
          <Button
            variant="outline"
            size="sm"
            className="gap-2 text-xs"
            disabled={busy !== null}
            onClick={() => run("pdf")}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/pdf.svg"
              alt="PDF"
              className="size-7 shrink-0 object-contain"
            />
            {busy === "pdf" ? "Preparing…" : "PDF"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="gap-2 text-xs"
            disabled={busy !== null}
            onClick={() => run("doc")}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/doc.svg"
              alt="DOC"
              className="size-5 shrink-0 object-contain"
            />
            {busy === "doc" ? "Preparing…" : "DOC"}
          </Button>
        </div>
      )}
    </div>
  );
}

/** What the agent returned. Text fields read as text; everything else as formatted JSON. */
export function RunOutput({
  outputJson,
  status,
  filename = "agent-output",
  title = "Agent output",
}: {
  outputJson: string | null;
  status: string;
  filename?: string;
  title?: string;
}) {
  if (!outputJson) {
    const active =
      status === "awaiting_input" ||
      status === "queued" ||
      status === "running";
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-border px-6 py-12 text-center">
        <p className="text-sm font-medium">
          {active ? "No output yet" : "No output"}
        </p>
        <p className="text-xs text-muted-foreground">
          {active
            ? "The answer appears here as soon as the agent finishes."
            : status === "succeeded"
              ? "This run finished before results were saved, so its answer is not available. Run the agent again to see it here."
              : "This run ended without returning an answer."}
        </p>
      </div>
    );
  }

  const value = parse(outputJson);
  const truncated =
    value &&
    typeof value === "object" &&
    (value as any).truncated === true &&
    typeof (value as any).preview === "string";
  const pretty = truncated
    ? (value as any).preview
    : JSON.stringify(value, null, 2);
  const sections =
    !truncated && value && typeof value === "object" && !Array.isArray(value)
      ? Object.entries(value as Record<string, unknown>)
      : null;

  return (
    <div className="min-h-0 flex-1 space-y-3 overflow-auto">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Result
        </h3>
        <CopyButton text={pretty} />
      </div>
      {truncated && (
        <p className="text-[11px] text-muted-foreground">
          Long output, showing the start only.
        </p>
      )}
      {sections ? (
        sections.map(([key, v]) => (
          <section
            key={key}
            className="overflow-hidden rounded-xl border border-border"
          >
            <div className="border-b border-border bg-muted/50 px-3 py-1.5 font-mono text-[11px] text-muted-foreground">
              {key}
            </div>
            {isText(v) ? (
              <div className="p-3">
                <Markdown>{v}</Markdown>
              </div>
            ) : (
              <pre className="max-h-96 overflow-auto p-3 font-mono text-xs leading-relaxed">
                {JSON.stringify(v, null, 2)}
              </pre>
            )}
          </section>
        ))
      ) : (
        <pre className="overflow-auto rounded-xl border border-border bg-muted/40 p-3 font-mono text-xs leading-relaxed">
          {pretty}
        </pre>
      )}
    </div>
  );
}

/** Older runs have no stored result; the agent's own "finished" event may still carry it. */
export function outputFromEvents(
  events: RunEvent[] | undefined,
): string | null {
  const done = events?.find((e) => e.type === "task.completed");
  if (!done) return null;
  const d = parse(done.dataJson);
  if (!d) return null;
  if (d.truncated && typeof d.preview === "string") return done.dataJson;
  return d.output === undefined ? null : JSON.stringify(d.output);
}
