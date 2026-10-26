import "dotenv/config";
import { createAgent } from "catelog";
import { InputSchema, OutputSchema, runJobFit, type JobFitInput, type JobFitOutput } from "./agent.js";

const mode = (process.env.JOBFIT_MODE as "sync" | "async") ?? "async";

export const agent = createAgent<JobFitInput, JobFitOutput>({
  id: "job-fit-agent",
  name: "Job Fit Agent",
  version: "1.0.0",
  description: "Finds real open jobs that match your query and (optionally) your resume. Returns a short answer plus job details.",
  mode,
  inputSchema: InputSchema,
  outputSchema: OutputSchema,
  capabilities: { max_timeout_seconds: 180 },
  limits: {
    maxConcurrent: Number(process.env.JOBFIT_MAX_CONCURRENT ?? 3),
    // base64 of a 5MB resume is ~6.7MB
    maxBodyBytes: 8 * 1024 * 1024,
    rateLimit: { max: Number(process.env.JOBFIT_RATE_LIMIT ?? 10), windowMs: 60_000 },
    trustProxy: process.env.TRUST_PROXY === "true",
  },

  async execute({ input, stream, signal, log, metric }) {
    const t0 = Date.now();
    console.log(`\n================== [JobFitAgent] INCOMING QUERY ==================`);
    console.log(`[JobFitAgent] Prompt: "${input.prompt}"`);
    console.log(`[JobFitAgent] Has Resume: ${!!input.resume_base64} (${input.resume_filename ?? "none"})`);
    console.log(`==================================================================\n`);

    log.info("Job search started", { has_resume: !!input.resume_base64, query: input.prompt });
    metric.count("runs");
    if (input.resume_base64) metric.count("resumes_uploaded");

    stream.step("Starting job search");
    stream.progress(5, input.resume_base64 ? "Parsing resume" : "Preparing search");

    try {
      console.log(`[JobFitAgent] Running Claude agent query...`);
      const { output, telemetry } = await runJobFit(input, stream, {
        signal,
        // Fires on success AND failure, so cost shows up even for failed runs.
        onUsage: (t) => {
          metric.gauge("cost_usd", t.cost_usd ?? 0);
          metric.gauge("tokens_prompt", t.llm_tokens?.prompt ?? 0);
          metric.gauge("tokens_completion", t.llm_tokens?.completion ?? 0);
        },
      });

      console.log(`[JobFitAgent] Agent execution finished in ${Date.now() - t0}ms`);
      console.log(`[JobFitAgent] Output response: "${output.response}"`);
      console.log(`[JobFitAgent] Jobs found: ${output.jobs?.length ?? 0}`);
      if (output.jobs && output.jobs.length > 0) {
        console.log(`[JobFitAgent] Top job: ${output.jobs[0].title} at ${output.jobs[0].company} (${output.jobs[0].url})`);
      }
      console.log(`[JobFitAgent] Telemetry: model=${telemetry?.model_used}, tokens=${telemetry?.llm_tokens?.total}, cost=$${telemetry?.cost_usd ?? 0}\n`);

      stream.progress(95, "Formatting results");
      for (const [i, job] of output.jobs.entries()) {
        stream.delta(JSON.stringify({ op: "add", path: `/jobs/${i}`, value: job }), "json_patch");
      }
      metric.gauge("jobs_returned", output.jobs.length);
      stream.progress(100, "Done");
      log.info("Job search completed", {
        jobs: output.jobs.length,
        cost_usd: telemetry?.cost_usd,
        tokens: telemetry?.llm_tokens?.total,
        model: telemetry?.model_used,
        ms: Date.now() - t0,
      });

      return { output, telemetry };
    } catch (err) {
      const e = err as Error & { code?: string };
      console.error(`\n❌ [JobFitAgent] ERROR OCCURRED:`, e.message || err);
      console.error(e.stack);
      log.error("Job search failed", { code: e.code ?? e.name, message: e.message, ms: Date.now() - t0 });
      metric.count("errors");
      throw err; // Catelog converts code/retryable into the structured error response
    }
  },
});

const port = Number(process.env.PORT ?? 5000);
agent.listen(port);
