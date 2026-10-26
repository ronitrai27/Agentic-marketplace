import { query, type ModelUsage } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { MAX_RESUME_BYTES, parseResume, ResumeError } from "./parse.js";

export const InputSchema = z
  .object({
    query: z.string().min(1).max(1000).describe("What kind of job you want, e.g. 'remote backend roles in Europe'"),
    resume_base64: z.string().optional().describe("Optional resume file (.pdf or .docx), base64-encoded"),
    resume_filename: z.string().optional().describe("Original file name, e.g. 'cv.pdf' (required with resume_base64)"),
  })
  .refine((v) => !v.resume_base64 || !!v.resume_filename, {
    message: "resume_filename is required when resume_base64 is provided",
    path: ["resume_filename"],
  });

export const JobSchema = z.object({
  title: z.string(),
  company: z.string(),
  location: z.string(),
  salary: z.string().optional().describe("Only if stated in the posting"),
  url: z.string().describe("Direct link to the posting, taken from search results"),
  match_score: z.number().min(0).max(100),
  match_reason: z.string().describe("One short line tying the job to the resume/query"),
});

export const OutputSchema = z.object({
  response: z.string().describe("2-3 sentence answer: what was found and who fits best"),
  jobs: z.array(JobSchema),
});
export type JobFitInput = z.infer<typeof InputSchema>;
export type JobFitOutput = z.infer<typeof OutputSchema>;

export type JobFitTelemetry = {
  llm_tokens: { prompt: number; completion: number; total: number };
  model_used: string;
  cost_usd: number;
  framework: Record<string, unknown>;
};

export interface JobFitHooks {
  signal?: AbortSignal;
  onStep?: (msg: string) => void;
  /** Called for every WebSearch/WebFetch call the model makes. */
  onTool?: (name: string, input: Record<string, unknown>, count: number) => void;
  /** Called once with usage, on success AND on failure, so cost is never lost. */
  onUsage?: (t: JobFitTelemetry) => void;
}

/** Errors carry `code` + `retryable`, which Catelog turns into the structured error response. */
export class JobFitError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "JobFitError";
  }
}

// The Claude CLI's validator rejects the "$schema" URL zod emits, so drop it.
const { $schema: _omit, ...OUTPUT_JSON_SCHEMA } = z.toJSONSchema(OutputSchema) as Record<string, unknown>;

const UPSTREAM: Record<string, [string, boolean]> = {
  rate_limit: ["MODEL_RATE_LIMIT", true],
  overloaded: ["MODEL_RATE_LIMIT", true],
  server_error: ["UPSTREAM_TIMEOUT", true],
  authentication_failed: ["MODEL_AUTH_FAILED", false],
  billing_error: ["MODEL_BILLING_ERROR", false],
  model_not_found: ["MODEL_NOT_FOUND", false],
  invalid_request: ["MODEL_INVALID_REQUEST", false],
};

const SYSTEM = `You are a job recommendation agent. Find REAL, currently open job postings that fit the user's query and resume.
Rules:
- Use WebSearch to find postings, WebFetch only to verify a promising posting. Do at most ~6 tool calls.
- Return 5 jobs (fewer only if you truly cannot find more). Every url MUST come from a search/fetch result. Never invent jobs, companies, salaries or links.
- match_reason is one short line. response is 2-3 sentences. No filler, no advice, no cover letters.
- Infer skills, seniority and location preference from the resume when provided; the user's query takes priority.`;

function toTelemetry(
  modelUsage: Record<string, ModelUsage>,
  cost: number,
  extra: Record<string, unknown>,
): JobFitTelemetry {
  const models = Object.entries(modelUsage);
  const sum = (f: (u: ModelUsage) => number) => models.reduce((n, [, u]) => n + f(u), 0);
  const prompt = sum((u) => u.inputTokens + u.cacheReadInputTokens + u.cacheCreationInputTokens);
  const completion = sum((u) => u.outputTokens);
  return {
    llm_tokens: { prompt, completion, total: prompt + completion },
    model_used: models.map(([m]) => m).join(",") || (process.env.JOBFIT_MODEL ?? "claude-haiku-5-5"),
    cost_usd: cost,
    framework: {
      engine: "claude-agent-sdk",
      cache_read_tokens: sum((u) => u.cacheReadInputTokens),
      cache_creation_tokens: sum((u) => u.cacheCreationInputTokens),
      web_search_requests: sum((u) => u.webSearchRequests),
      per_model: modelUsage,
      ...extra,
    },
  };
}

export async function runJobFit(
  raw: JobFitInput | { query: string; resumeText?: string },
  hooks: JobFitHooks = {},
): Promise<{ output: JobFitOutput; telemetry: JobFitTelemetry }> {
  let resume = "";
  if ("resumeText" in raw && raw.resumeText) {
    resume = raw.resumeText;
  } else if ("resume_base64" in raw && raw.resume_base64) {
    hooks.onStep?.("Parsing resume");
    const buf = Buffer.from(raw.resume_base64, "base64");
    if (buf.length > MAX_RESUME_BYTES) throw new ResumeError("Resume file is larger than 5MB");
    resume = await parseResume(buf, raw.resume_filename ?? "");
  }

  const prompt = `Query: ${raw.query}\n\n${resume ? `Resume:\n"""\n${resume}\n"""` : "(no resume provided)"}`;

  const abort = new AbortController();
  if (hooks.signal) {
    if (hooks.signal.aborted) abort.abort();
    else hooks.signal.addEventListener("abort", () => abort.abort(), { once: true });
  }

  const toolCalls: Record<string, number> = {};
  let toolCount = 0;
  let upstreamError: string | undefined;

  const stream = query({
    prompt,
    options: {
      model: process.env.JOBFIT_MODEL ?? "claude-haiku-5-5",
      systemPrompt: SYSTEM,
      tools: ["WebSearch", "WebFetch"],
      allowedTools: ["WebSearch", "WebFetch"],
      permissionMode: "dontAsk",
      settingSources: [],
      persistSession: false,
      abortController: abort,
      maxTurns: 12,
      maxBudgetUsd: Number(process.env.JOBFIT_MAX_BUDGET_USD ?? 0.15),
      outputFormat: { type: "json_schema", schema: OUTPUT_JSON_SCHEMA },
    },
  });

  for await (const msg of stream) {
    if (msg.type === "assistant") {
      if (msg.error) upstreamError = msg.error;
      for (const block of msg.message.content) {
        if (block.type === "tool_use" && block.name !== "StructuredOutput") {
          toolCalls[block.name] = (toolCalls[block.name] ?? 0) + 1;
          hooks.onTool?.(block.name, block.input as Record<string, unknown>, ++toolCount);
        }
      }
      continue;
    }
    if (msg.type !== "result") continue;

    const telemetry = toTelemetry(msg.modelUsage, msg.total_cost_usd, {
      num_turns: msg.num_turns,
      duration_api_ms: msg.duration_api_ms,
      tool_calls: toolCalls,
      stop_reason: msg.stop_reason,
      result_subtype: msg.subtype,
    });
    hooks.onUsage?.(telemetry);

    if (msg.subtype === "success" && msg.structured_output) {
      const parsed = OutputSchema.safeParse(msg.structured_output);
      if (parsed.success) return { output: parsed.data, telemetry };
      throw new JobFitError("Model returned malformed output", "INTERNAL_CRASH", true);
    }
    if (upstreamError && UPSTREAM[upstreamError]) {
      const [code, retryable] = UPSTREAM[upstreamError];
      throw new JobFitError(`Model API error: ${upstreamError}`, code, retryable);
    }
    if (msg.subtype === "error_max_budget_usd") {
      throw new JobFitError("Run exceeded its cost cap before finishing", "BUDGET_EXCEEDED", false);
    }
    if (msg.subtype === "error_max_turns") {
      throw new JobFitError("Agent ran out of turns before finding results", "TOOL_FAILURE", true);
    }
    if ("api_error_status" in msg && msg.api_error_status === 429) {
      throw new JobFitError("Model rate limit reached", "MODEL_RATE_LIMIT", true);
    }
    throw new JobFitError(`Agent failed (${msg.subtype})`, "INTERNAL_CRASH", true);
  }
  if (abort.signal.aborted) throw Object.assign(new Error("aborted"), { name: "AbortError" });
  throw new JobFitError("Agent ended without a result", "INTERNAL_CRASH", true);
}
