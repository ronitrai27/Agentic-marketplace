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

  async execute({ input, stream, signal, log, metric, runId }) {
    const t0 = Date.now();
    log.info("Job search started", { runId, has_resume: !!input.resume_base64, query: input.query });
    metric.count("runs");
    if (input.resume_base64) metric.count("resumes_uploaded");

    stream.step("Starting job search");
    stream.progress(5, input.resume_base64 ? "Parsing resume" : "Preparing search");

    try {
      const { output, telemetry } = await runJobFit(input, {
        signal,
        onStep: (m) => {
          stream.step(m);
          log.debug(m);
        },
        onTool: (name, toolInput, n) => {
          const detail = (toolInput.query ?? toolInput.url ?? "") as string;
          stream.activity(name === "WebSearch" ? "web_search" : "web_fetch", { n, detail });
          stream.progress(Math.min(15 + n * 12, 85), name === "WebSearch" ? "Searching job boards" : "Verifying a posting");
          metric.count(`tool_${name}`);
          log.info(`Tool call #${n}: ${name}`, { detail });
          if (stream.isClosed()) log.warn("Client disconnected; aborting run");
        },
        // Fires on success AND failure, so cost shows up even for failed runs.
        onUsage: (t) => {
          metric.gauge("cost_usd", t.cost_usd);
          metric.gauge("tokens_prompt", t.llm_tokens.prompt);
          metric.gauge("tokens_completion", t.llm_tokens.completion);
        },
      });

      stream.progress(95, "Formatting results");
      stream.delta(output.response, "text");
      for (const [i, job] of output.jobs.entries()) {
        stream.delta(JSON.stringify({ op: "add", path: `/jobs/${i}`, value: job }), "json_patch");
      }
      metric.gauge("jobs_returned", output.jobs.length);
      stream.progress(100, "Done");
      log.info("Job search completed", {
        jobs: output.jobs.length,
        cost_usd: telemetry.cost_usd,
        tokens: telemetry.llm_tokens.total,
        model: telemetry.model_used,
        ms: Date.now() - t0,
      });

      return { output, telemetry };
    } catch (err) {
      const e = err as Error & { code?: string; retryable?: boolean };
      log.error("Job search failed", { code: e.code ?? e.name, message: e.message, ms: Date.now() - t0 });
      metric.count("errors");
      throw err; // Catelog converts code/retryable into the structured error response
    }
  },
});

const port = Number(process.env.PORT ?? 3000);
agent.listen(port);

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, async () => {
    await agent.shutdown();
    process.exit(0);
  });
}
