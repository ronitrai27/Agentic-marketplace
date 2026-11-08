import type { AgentStream } from "catelog";

/**
 * Depth tier: a ~2 minute preparation phase before the real work, so the marketplace's long-running path
 * (async task, SSE progress, heartbeats, timeouts, cancel) can be exercised with a report agent that is
 * otherwise done in seconds. It only waits; it emits a progress event every few seconds so the run never looks stuck.
 */
export const DEPTH_WARMUP_MS = 120_000;
/** Share of the progress bar the warm-up takes; the real work is mapped onto the rest. */
export const DEPTH_SHARE = 30;

const TICK_MS = 5_000;

const STAGES = [
  "Planning the report outline",
  "Breaking the topic into questions",
  "Lining up sources to check",
  "Ranking sources by relevance",
  "Cross-checking key facts",
  "Drafting section structure",
  "Reviewing coverage gaps",
  "Preparing the writing brief",
];

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(abortError());
    const t = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(abortError());
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

const abortError = () => Object.assign(new Error("Run cancelled"), { name: "AbortError", code: "CANCELLED", retryable: false });

export async function depthWarmup(stream: AgentStream, signal: AbortSignal, totalMs = DEPTH_WARMUP_MS): Promise<void> {
  const ticks = Math.max(1, Math.round(totalMs / TICK_MS));
  const perStage = Math.max(1, Math.ceil(ticks / STAGES.length));
  const started = Date.now();
  for (let i = 0; i < ticks; i++) {
    const stage = STAGES[Math.min(STAGES.length - 1, Math.floor(i / perStage))];
    if (i % perStage === 0) stream.step(stage);
    const left = Math.max(0, Math.round((totalMs - (Date.now() - started)) / 1000));
    stream.progress(Math.round(1 + (i / ticks) * (DEPTH_SHARE - 1)), `${stage} (${left}s left in preparation)`);
    await sleep(TICK_MS, signal);
  }
  stream.progress(DEPTH_SHARE, "Preparation done, starting the report");
}

/** The real work's 0-100 progress, squeezed into DEPTH_SHARE..100 so the bar never goes backwards. */
export function offsetProgress(stream: AgentStream, from = DEPTH_SHARE): AgentStream {
  // a Proxy, not a spread: the SDK's stream may be a class whose methods live on the prototype
  return new Proxy(stream, {
    get(target, key) {
      if (key === "progress") {
        return (p: number, m?: string) => target.progress(Math.round(from + (p / 100) * (100 - from)), m);
      }
      const v = Reflect.get(target, key);
      return typeof v === "function" ? v.bind(target) : v;
    },
  });
}
