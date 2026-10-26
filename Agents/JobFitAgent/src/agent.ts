import { query } from "@anthropic-ai/claude-agent-sdk";
import {
  pipeClaudeAgentStream,
  type AgentStream,
  type TelemetryData,
} from "catelog";
import { z } from "zod";
import { MAX_RESUME_BYTES, parseResume, ResumeError } from "./parse.js";

export const InputSchema = z
  .object({
    prompt: z
      .string()
      .trim()
      .min(1)
      .max(1000)
      .describe(
        "What kind of job you want, e.g. 'remote backend roles in Europe'",
      ),
    resume_base64: z
      .string()
      .optional()
      .describe("Optional resume file (.pdf or .docx), base64-encoded"),
    resume_filename: z
      .string()
      .optional()
      .describe(
        "Original file name, e.g. 'cv.pdf' (required with resume_base64)",
      ),
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
  url: z
    .string()
    .describe("Direct link to the posting, taken from search results"),
  match_score: z.number().min(0).max(100),
  match_reason: z
    .string()
    .describe("One short line tying the job to the resume/query"),
});

export const OutputSchema = z.object({
  response: z
    .string()
    .describe("2-3 sentence answer: what was found and who fits best"),
  jobs: z.array(JobSchema),
});
export type JobFitInput = z.infer<typeof InputSchema>;
export type JobFitOutput = z.infer<typeof OutputSchema>;

const SYSTEM = `You are a job recommendation agent. Find REAL, currently open job postings that fit the user's query and resume.
Rules:
- Use WebSearch to find postings, WebFetch only to verify a promising posting. Do at most ~6 tool calls.
- Return 5 jobs (fewer only if you truly cannot find more). Every url MUST come from a search/fetch result. Never invent jobs, companies, salaries or links.
- response: at most 2 short sentences (under 280 characters): how many jobs and which fits best. match_reason: one line, under 20 words.
- If the user's message is not a job request (e.g. a greeting) and there is no resume, do not search: return an empty jobs array and a one-sentence response asking for role, location and seniority.
- No filler, no advice, no cover letters, no caveats about the search process.
- Infer skills, seniority and location preference from the resume when provided; the user's query takes priority.`;

// The Claude CLI rejects the "$schema" URL zod emits, so drop it.
const { $schema: _omit, ...OUTPUT_JSON_SCHEMA } = z.toJSONSchema(
  OutputSchema,
) as Record<string, unknown>;

/** Drops repeat postings (same URL, or same company + title) and keeps the best-scored copy. */
export function dedupeJobs(out: JobFitOutput): JobFitOutput {
  const norm = (v: string) =>
    v
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  const seen = new Set<string>();
  const jobs = [...out.jobs]
    .sort((a, b) => b.match_score - a.match_score)
    .filter((j) => {
      const keys = [
        `u:${j.url.split("#")[0].replace(/\/$/, "")}`,
        `t:${norm(j.company)}|${norm(j.title)}`,
      ];
      if (keys.some((k) => seen.has(k))) return false;
      keys.forEach((k) => seen.add(k));
      return true;
    });
  return { ...out, jobs };
}

export interface JobFitRequest {
  prompt: string;
  resume_base64?: string;
  resume_filename?: string;
  /** Already-parsed resume text (CLI path). Takes priority over resume_base64. */
  resumeText?: string;
}

export interface RunOptions {
  signal?: AbortSignal;
  /** Fires with final telemetry on success and failure, so cost is never lost. */
  onUsage?: (t: TelemetryData) => void;
}

/** Parses the optional resume and builds the Claude query (Haiku, web tools only, hard budget cap). */
async function buildQuery(req: JobFitRequest) {
  let resume = req.resumeText ?? "";
  if (!resume && req.resume_base64) {
    const buf = Buffer.from(req.resume_base64, "base64");
    if (buf.length > MAX_RESUME_BYTES)
      throw new ResumeError("Resume file is larger than 5MB");
    resume = await parseResume(buf, req.resume_filename ?? "");
  }

  const model = process.env.JOBFIT_MODEL || "claude-haiku-5-5";
  const maxBudget = Number(process.env.JOBFIT_MAX_BUDGET_USD ?? 0.15);
  console.log(
    `[JobFitAgent] Initializing query with model: ${model}, maxBudget: $${maxBudget}`,
  );

  return query({
    prompt: `Query: ${req.prompt}\n\n${resume ? `Resume:\n"""\n${resume}\n"""` : "(no resume provided)"}`,
    options: {
      model,
      systemPrompt: SYSTEM,
      tools: ["WebSearch", "WebFetch"],
      allowedTools: ["WebSearch", "WebFetch"],
      permissionMode: "dontAsk",
      settingSources: [],
      persistSession: false,
      maxTurns: 12,
      maxBudgetUsd: maxBudget,
      outputFormat: { type: "json_schema", schema: OUTPUT_JSON_SCHEMA },
    },
  });
}

/**
 * Runs the agent. Catelog's Claude adapter turns tool calls into stream events, fills in
 * cost/tokens/model telemetry, and maps Claude failures to Catelog error codes.
 */
export async function runJobFit(
  req: JobFitRequest,
  stream: AgentStream,
  opts: RunOptions = {},
) {
  return pipeClaudeAgentStream<JobFitOutput>(await buildQuery(req), stream, {
    ...opts,
    parse: (raw) => dedupeJobs(OutputSchema.parse(raw)),
  });
}
