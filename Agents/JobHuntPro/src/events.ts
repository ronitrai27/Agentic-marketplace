import type { AgentExecutionContext, UsageRecord } from "catelog";

/**
 * Everything the search loop reports goes through this interface, so the same loop
 * drives the CLI (console) and the Catelog server (SSE events + telemetry).
 */
export interface Reporter {
  step(label: string): void;
  progress(percent: number, message?: string): void;
  activity(type: string, data?: Record<string, unknown>): void;
  emit(name: string, data: Record<string, unknown>): void;
  delta(content: string, type?: "text" | "json_patch"): void;
  /** Telemetry adapter hook: one call per LLM request. */
  usage(rec: UsageRecord): void;
  isClosed(): boolean;
  signal?: AbortSignal;
}

/** CLI reporter: human-readable lines on stderr, accumulates usage for a final summary. */
export function consoleReporter(): Reporter & { totals(): { calls: number; prompt: number; completion: number } } {
  let calls = 0, prompt = 0, completion = 0;
  const say = (m: string) => console.error(`  • ${m}`);
  return {
    step: say,
    progress: (p, m) => m && say(`[${Math.round(p)}%] ${m}`),
    activity: (t, d) => say(`${t} ${d ? JSON.stringify(d).slice(0, 110) : ""}`),
    emit: (n, d) => n === "job.found" && say(`+ ${(d as any).title} @ ${(d as any).company} (${(d as any).score})`),
    delta: () => {},
    usage: (r) => {
      calls += r.calls ?? 1;
      prompt += r.tokens?.prompt ?? 0;
      completion += r.tokens?.completion ?? 0;
    },
    isClosed: () => false,
    totals: () => ({ calls, prompt, completion }),
  };
}

/** Server reporter: maps loop events to Catelog SSE events and `ctx.usage` / `ctx.metric` telemetry. */
export function catelogReporter(ctx: AgentExecutionContext<any>): Reporter {
  let lastPct = 0;
  return {
    // stream.step() would emit a 0% progress event; keep the bar where it is and just change the label.
    step: (l) => ctx.stream.progress(lastPct, l),
    // Progress only ever moves forward, so clients never see the bar jump back.
    progress: (p, m) => {
      lastPct = Math.max(lastPct, Math.min(100, Math.round(p)));
      ctx.stream.progress(lastPct, m);
    },
    activity: (t, d) => ctx.stream.activity(t, d),
    emit: (n, d) => ctx.stream.emit(n, d),
    delta: (c, t) => ctx.stream.delta(c, t),
    usage: (r) => {
      ctx.usage.record(r);
      ctx.metric.count("llm_calls", r.calls ?? 1);
    },
    isClosed: () => ctx.stream.isClosed(),
    signal: ctx.signal,
  };
}
