import type OpenAI from "openai";

// ─────────────────────────────────────────────────────────────────────────────
//  Shared research pipelines (used by the marketplace /execute route, the web UI
//  /api/chat route and the CLI). Transport-agnostic: callers pass an `emit` sink.
// ─────────────────────────────────────────────────────────────────────────────

export const FAST_MODEL = "gpt-6-luna";
export const SEARCH_MODEL = "gpt-6-luna";
export const VERIFY_MODEL = "gpt-4.1-mini";
export const FORMAT_MODEL = "gpt-6-luna";

/** Deep mode always takes at least this long (progress is streamed meanwhile). */
export const DEEP_MIN_MS = 3 * 60 * 1000;

export interface Source {
  title: string;
  url: string;
}

export interface Usage {
  prompt: number;
  completion: number;
}

export interface ResearchEvent {
  /** high level phase id */
  phase: string;
  message: string;
  /** 0-100 */
  percent?: number;
  /** optional extra payload (e.g. web search query) */
  data?: Record<string, unknown>;
}

export type Emit = (e: ResearchEvent) => void;

export interface ResearchResult {
  answer: string;
  model: string;
  models: string[];
  sources: Source[];
  usage: Usage;
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(new Error("EXECUTION_TIMEOUT"));
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        reject(new Error("EXECUTION_TIMEOUT"));
      },
      { once: true },
    );
  });

/** Pull unique url_citation annotations out of a Responses API result. */
export function extractSources(response: any): Source[] {
  const seen = new Map<string, Source>();
  for (const item of response?.output ?? []) {
    if (item?.type !== "message") continue;
    for (const part of item.content ?? []) {
      for (const a of part?.annotations ?? []) {
        if (a?.type === "url_citation" && a.url && !seen.has(a.url)) {
          seen.set(a.url, { title: a.title || a.url, url: a.url });
        }
      }
    }
  }
  return [...seen.values()];
}

function searchQueries(response: any): string[] {
  const out: string[] = [];
  for (const item of response?.output ?? []) {
    if (item?.type === "web_search_call") {
      const q = item?.action?.query ?? item?.query;
      if (q) out.push(String(q));
    }
  }
  return out;
}

function usageOf(response: any): Usage {
  return {
    prompt: response?.usage?.input_tokens ?? 0,
    completion: response?.usage?.output_tokens ?? 0,
  };
}

const sourceBlock = (sources: Source[]) =>
  sources.length
    ? sources.map((s, i) => `[${i + 1}] ${s.title} — ${s.url}`).join("\n")
    : "(none returned)";

// ─────────────────────────────────────────────────────────────────────────────
//  FAST: single gpt-6-luna call with OpenAI's built-in web_search tool
// ─────────────────────────────────────────────────────────────────────────────

const FAST_INSTRUCTIONS = `You are a research assistant. Use the web_search tool to ground every factual claim.
Reply with a properly structured Markdown report:
# <Title>
## Summary (2-4 sentences)
## Key Findings (sections with ## / ### headings, bullet points, tables where useful)
## Conclusion
## Citations (LAST section: numbered list "[n] Title — URL"; every [n] used in the body must appear here)
Cite inline with [n] markers. Never invent sources.`;

export async function runFast(
  client: OpenAI,
  prompt: string,
  emit: Emit,
  signal?: AbortSignal,
): Promise<ResearchResult> {
  emit({
    phase: "searching",
    message: `Running web search with ${FAST_MODEL}...`,
    percent: 10,
  });

  const response: any = await client.responses.create(
    {
      model: FAST_MODEL,
      instructions: FAST_INSTRUCTIONS,
      input: prompt,
      tools: [{ type: "web_search" }],
    },
    { signal },
  );

  for (const q of searchQueries(response)) {
    emit({ phase: "web_search", message: `Searched: ${q}`, data: { query: q } });
  }

  return {
    answer: response.output_text || "No response generated.",
    model: FAST_MODEL,
    models: [FAST_MODEL],
    sources: extractSources(response),
    usage: usageOf(response),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
//  DEEP: 3 min paced run → luna search → gpt-4.1-mini verify → luna formatter
// ─────────────────────────────────────────────────────────────────────────────

const FAKE_STAGES = [
  "Understanding the research question...",
  "Planning search strategy & sub-queries...",
  "Scanning academic & news sources...",
  "Cross-referencing publications and patents...",
  "Extracting key claims and data points...",
  "Checking source credibility...",
  "Detecting overlap / plagiarism risk...",
  "Structuring findings...",
  "Drafting report sections...",
  "Polishing citations...",
];

/**
 * Streams paced pseudo-progress (0→~90%) until `ms` elapsed. Purely cosmetic:
 * gives the user a sense of depth while the real pipeline runs in parallel.
 */
async function fakeProgress(ms: number, emit: Emit, signal?: AbortSignal) {
  const tick = 6_000;
  const start = Date.now();
  let i = 0;
  while (Date.now() - start < ms) {
    const frac = (Date.now() - start) / ms;
    emit({
      phase: "deep_progress",
      message: FAKE_STAGES[Math.min(i, FAKE_STAGES.length - 1)],
      percent: Math.min(90, Math.round(5 + frac * 85)),
      data: { elapsed_seconds: Math.round((Date.now() - start) / 1000) },
    });
    i = Math.floor(frac * FAKE_STAGES.length) + 1;
    await sleep(Math.min(tick, Math.max(0, ms - (Date.now() - start))), signal);
  }
}

const SEARCH_INSTRUCTIONS = `You are the SEARCH agent of a deep research pipeline.
Use web_search extensively (multiple distinct queries) and gather thorough, factual, recent findings.
Output raw research notes in Markdown: grouped by sub-topic, concrete facts/numbers/dates, each claim followed by its source URL.
Do NOT format a final report; a later agent does that. Never invent sources.`;

const VERIFY_INSTRUCTIONS = `You are the VERIFICATION agent. You receive a research question, raw research notes and the list of sources.
For each major claim decide: VERIFIED (supported by a listed source), UNSUPPORTED (no source backs it), or CONTRADICTED/QUESTIONABLE.
Output Markdown:
## Verified Claims
## Unsupported / Questionable Claims (with why)
## Corrections (what must be changed or removed)
## Confidence (low/medium/high, one line why)
Be strict and concise. Do not add new facts.`;

const FORMAT_INSTRUCTIONS = `You are the REPORT FORMATTER. You receive the research question, research notes, verification notes and sources.
Produce the FINAL report in clean Markdown with exactly this layout:

# <Report Title>
> *Deep Research Report* · <today's date> · Prepared by Nova Research
(a short 2-3 line abstract)

---
## Index
A numbered table of contents listing every section below.

---
## 1. Executive Summary
## 2..N. <Content sections with ##/### headings, bullets, tables>
## Limitations & Verification Notes  (reflect the verification notes honestly; drop or flag UNSUPPORTED claims)
---
## Citations
Numbered "[n] Title — URL" list. Use only the provided sources. Every inline [n] must resolve here.

Rules: remove anything the verifier flagged as unsupported/contradicted, use inline [n] markers, do not invent facts or sources.`;

export async function runDeep(
  client: OpenAI,
  prompt: string,
  emit: Emit,
  signal?: AbortSignal,
  minMs = DEEP_MIN_MS,
): Promise<ResearchResult> {
  const usage: Usage = { prompt: 0, completion: 0 };
  const add = (u: Usage) => {
    usage.prompt += u.prompt;
    usage.completion += u.completion;
  };

  // Start cosmetic progress; real work runs concurrently and result is held
  // until the minimum duration has elapsed.
  const floor = fakeProgress(minMs, emit, signal);
  floor.catch(() => {}); // surfaced when awaited below

  const pipeline = (async () => {
    // 1. SEARCH ─ gpt-6-luna + web_search
    const search: any = await client.responses.create(
      {
        model: SEARCH_MODEL,
        instructions: SEARCH_INSTRUCTIONS,
        input: prompt,
        tools: [{ type: "web_search" }],
      },
      { signal },
    );
    add(usageOf(search));
    const notes: string = search.output_text || "";
    const sources = extractSources(search);
    for (const q of searchQueries(search)) {
      emit({ phase: "web_search", message: `Searched: ${q}`, data: { query: q } });
    }
    emit({
      phase: "search_done",
      message: `${SEARCH_MODEL} gathered notes from ${sources.length} sources`,
      data: { sources: sources.length },
    });

    // 2. VERIFY ─ gpt-4.1-mini
    emit({ phase: "verifying", message: `Verifying claims with ${VERIFY_MODEL}...` });
    const verify: any = await client.responses.create(
      {
        model: VERIFY_MODEL,
        instructions: VERIFY_INSTRUCTIONS,
        input: `QUESTION:\n${prompt}\n\nRESEARCH NOTES:\n${notes}\n\nSOURCES:\n${sourceBlock(sources)}`,
      },
      { signal },
    );
    add(usageOf(verify));
    const verification: string = verify.output_text || "";
    emit({ phase: "verified", message: "Verification complete" });

    // 3. FORMAT ─ gpt-6-luna → cover, index, content, citations
    emit({ phase: "formatting", message: `Formatting final report with ${FORMAT_MODEL}...` });
    const format: any = await client.responses.create(
      {
        model: FORMAT_MODEL,
        instructions: FORMAT_INSTRUCTIONS,
        input:
          `TODAY: ${new Date().toISOString().slice(0, 10)}\n\nQUESTION:\n${prompt}\n\n` +
          `RESEARCH NOTES:\n${notes}\n\nVERIFICATION NOTES:\n${verification}\n\n` +
          `SOURCES:\n${sourceBlock(sources)}`,
      },
      { signal },
    );
    add(usageOf(format));

    return { answer: format.output_text || "", sources };
  })();
  // avoid unhandled rejection if the floor timer rejects first
  pipeline.catch(() => {});

  const [{ answer, sources }] = await Promise.all([pipeline, floor]);
  emit({ phase: "complete", message: "Report ready", percent: 100 });

  return {
    answer: answer || "No report generated.",
    model: FORMAT_MODEL,
    models: [SEARCH_MODEL, VERIFY_MODEL, FORMAT_MODEL],
    sources,
    usage,
  };
}
