import "dotenv/config";
import { createAgent } from "catelog";
import { z } from "zod";
import { catelogReporter } from "./events.js";
import { huntJobs } from "./loop.js";
import { MAX_RESUME_BYTES, parseResume } from "./parse.js";

export const InputSchema = z
  .object({
    prompt: z
      .string()
      .trim()
      .min(1)
      .max(1000)
      .describe("Role you want, e.g. 'senior TypeScript backend, remote'"),
    location: z
      .string()
      .trim()
      .max(100)
      .optional()
      .describe("Optional location, e.g. 'Berlin, Germany' or 'Remote'"),
    resume_base64: z
      .string()
      .optional()
      .describe("Optional resume (.pdf or .docx), base64-encoded"),
    resume_filename: z
      .string()
      .optional()
      .describe("Original file name, required with resume_base64"),
  })
  .refine((v) => !v.resume_base64 || !!v.resume_filename, {
    message: "resume_filename is required when resume_base64 is provided",
    path: ["resume_filename"],
  });
type Input = z.infer<typeof InputSchema>;

const Kw = z.array(z.object({ term: z.string(), jobs: z.number() }));
export const OutputSchema = z.object({
  jobs: z
    .array(
      z.object({
        title: z.string(),
        company: z.string(),
        location: z.string(),
        url: z.string(),
        source: z.string(),
        score: z.number(),
        why_fits: z.string(),
        missing_keywords: z.array(z.string()),
        partial: z.boolean().optional(),
      }),
    )
    .max(15),
  resume_keywords: z.object({ have: Kw, add: Kw }),
  stats: z.object({
    rounds: z.number(),
    seconds: z.number(),
    fetched: z.number(),
    verified: z.number(),
    serp_calls: z.number(),
  }),
});
type Output = z.infer<typeof OutputSchema>;

const agent = createAgent<Input, Output>({
  id: "job-hunt-pro",
  name: "JobHuntPro",
  version: "1.1.0",
  mode: (process.env.JOBHUNT_MODE as "sync" | "async") ?? "sync",
  inputSchema: InputSchema,
  outputSchema: OutputSchema,
  maxTimeoutMinute: 3,
  limits: {
    maxConcurrent: Number(process.env.JOBHUNT_MAX_CONCURRENT ?? 3),
    maxBodyBytes: 8 * 1024 * 1024, // base64 of a 5MB resume is ~6.7MB
    rateLimit: {
      max: Number(process.env.JOBHUNT_RATE_LIMIT ?? 10),
      windowMs: 60_000,
    },
    trustProxy: process.env.TRUST_PROXY === "true",
  },

  async execute(ctx) {
    const { input, log, metric } = ctx;
    const rep = catelogReporter(ctx);
    const t0 = Date.now();
    log.info("Job hunt started", {
      query: input.prompt,
      has_resume: !!input.resume_base64,
    });
    metric.count("runs");

    try {
      let resume = "";
      if (input.resume_base64) {
        const buf = Buffer.from(input.resume_base64, "base64");
        if (buf.length > MAX_RESUME_BYTES)
          throw Object.assign(new Error("Resume file is larger than 5MB"), {
            code: "INVALID_INPUT",
            retryable: false,
          });
        resume = await parseResume(buf, input.resume_filename ?? "");
        metric.count("resumes_uploaded");
      }

      const r = await huntJobs(rep, input.prompt, resume, input.location);

      // Stream the final list as JSON patches so UIs can render it incrementally.
      r.jobs.forEach((job, i) =>
        rep.delta(
          JSON.stringify({ op: "add", path: `/jobs/${i}`, value: job }),
          "json_patch",
        ),
      );
      metric.gauge("jobs_returned", r.jobs.length);
      metric.gauge("rounds", r.stats.rounds);
      metric.gauge("postings_checked", r.stats.fetched);
      metric.gauge("serp_calls", r.stats.serp_calls);
      rep.progress(100, `Done: ${r.jobs.length} jobs`);
      log.info("Job hunt completed", {
        ...r.stats,
        jobs: r.jobs.length,
        ms: Date.now() - t0,
      });

      // Token/model telemetry was recorded per LLM call via ctx.usage; Catelog merges it.
      return {
        output: {
          jobs: r.jobs.map(
            ({ key: _k, description: _d, skills: _s, ...j }) => j,
          ),
          resume_keywords: r.resume_keywords,
          stats: r.stats,
        },
      };
    } catch (err) {
      const e = err as Error & { code?: string };
      log.error("Job hunt failed", {
        code: e.code ?? e.name,
        message: e.message,
        ms: Date.now() - t0,
      });
      metric.count("errors");
      throw err; // Catelog turns code/retryable into the structured error event
    }
  },
});

agent.listen(Number(process.env.PORT ?? 3000));
