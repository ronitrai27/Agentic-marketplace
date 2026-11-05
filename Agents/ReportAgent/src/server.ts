import "dotenv/config";
import { createAgent } from "catelog";
import { runReport } from "./agent.js";
import {
  InputSchema,
  OutputSchema,
  type ReportInput,
  type ReportOutput,
} from "./schema.js";

export const agent = createAgent<ReportInput, ReportOutput>({
  id: "report-agent",
  name: "Report Agent",
  version: "2.1.0",
  description:
    "Writes a structured report on any topic or uploaded document. Instant mode is fast and short; detailed mode is deeper. Delivered as PDF or DOCX.",
  mode: "async",
  inputSchema: InputSchema,
  outputSchema: OutputSchema,
  // Local CPU models are slow; detailed mode makes several cloud calls.
  maxTimeoutMinute: 6,
  limits: {
    maxConcurrent: Number(process.env.REPORT_MAX_CONCURRENT ?? 2),
    // base64 of an 8MB document is ~10.7MB
    maxBodyBytes: 12 * 1024 * 1024,
    rateLimit: {
      max: Number(process.env.REPORT_RATE_LIMIT ?? 10),
      windowMs: 60_000,
    },
    trustProxy: process.env.TRUST_PROXY === "true",
  },

  async execute({ input, runId, stream, signal, log, metric, usage }) {
    const t0 = Date.now();
    log.info("Report started", {
      mode: input.mode,
      format: input.output_format,
      has_file: !!input.file_base64,
    });
    metric.count("runs");
    metric.count(`mode_${input.mode}`);
    stream.step("Starting");

    try {
      const output = await runReport(input, { runId, stream, usage, signal });
      log.info("Report completed", {
        words: output.word_count,
        ms: Date.now() - t0,
      });
      // Models, tokens and cost are collected from ctx.usage automatically.
      return { output };
    } catch (err) {
      const e = err as Error & { code?: string };
      log.error("Report failed", {
        code: e.code ?? e.name,
        message: e.message,
        ms: Date.now() - t0,
      });
      metric.count("errors");
      throw err; // Catelog maps code/retryable into the structured error
    }
  },
});

agent.listen(Number(process.env.PORT ?? 4000));
