import "dotenv/config";
import { createAgent } from "catelog";
import { z } from "zod";
import { config } from "./config.js";
import { createAnalysis, getAnalysis } from "./store/db.js";
import { runAnalysis } from "./workflow/index.js";
import type { AnalysisRow } from "./store/db.js";

const InputSchema = z.object({
  inventionTitle: z.string().min(1, "Invention title is required"),
  inventionDescription: z.string().min(50, "Description must be at least 50 characters"),
  jurisdiction: z.enum(["IN", "US"]).optional().default("IN"),
});

const OutputSchema = z.object({
  analysisId: z.string(),
  status: z.string(),
  score: z.number().optional(),
  verdict: z.string().optional(),
  summary: z.string().optional(),
  claims: z.array(z.any()).optional(),
  matches: z.array(z.any()).optional(),
});

type PatentInput = z.infer<typeof InputSchema>;
type PatentOutput = z.infer<typeof OutputSchema>;

export const agent = createAgent<PatentInput, PatentOutput>({
  id: "ai-patent-agent",
  name: "AI Patent Agent",
  version: "1.0.0",
  description:
    "AI prior-art research agent for patent applications. Searches IP India, arXiv, and academic sources, charts claims, and produces a novelty scorecard.",
  mode: "async",
  inputSchema: InputSchema,
  outputSchema: OutputSchema,
  maxTimeoutMinute: 10,
  limits: {
    maxConcurrent: Number(process.env.PATENT_MAX_CONCURRENT ?? 2),
    maxBodyBytes: 5 * 1024 * 1024,
    rateLimit: { max: Number(process.env.PATENT_RATE_LIMIT ?? 5), windowMs: 60_000 },
    trustProxy: process.env.TRUST_PROXY === "true",
  },

  async execute({ input, stream, log, metric }) {
    const t0 = Date.now();
    log.info("Patent analysis started", {
      title: input.inventionTitle,
      jurisdiction: input.jurisdiction,
    });
    metric.count("runs");

    stream.step("Initializing patent analysis");
    stream.progress(5, "Creating analysis record");

    // Derive a stable draft hash from the input content
    const draftText = `Title: ${input.inventionTitle}\n\n${input.inventionDescription}`;
    const draftHash = Buffer.from(draftText).toString("base64").slice(0, 64);
    const cfg = config();
    const tenantId = cfg.TENANT_DEMO_ID;

    let analysisId: string;
    try {
      const row = await createAnalysis({
        tenantId,
        draftHash,
        inputKind: "text",
        inputName: input.inventionTitle,
        draftChars: draftText.length,
        draftText,
      });
      analysisId = row.id;
    } catch (err) {
      const e = err as Error;
      log.error("Failed to create analysis record", { message: e.message });
      throw Object.assign(new Error(`Failed to create analysis: ${e.message}`), {
        code: "INTERNAL_CRASH",
        retryable: true,
      });
    }

    log.info("Analysis record created", { analysisId });
    stream.progress(10, "Starting pipeline");

    try {
      await runAnalysis(analysisId);
    } catch (err) {
      const e = err as Error;
      log.error("Pipeline failed", { analysisId, message: e.message, ms: Date.now() - t0 });
      metric.count("errors");
      throw Object.assign(new Error(`Pipeline failed: ${e.message}`), {
        code: "INTERNAL_CRASH",
        retryable: true,
      });
    }

    stream.progress(90, "Fetching results");

    const completed = await getAnalysis(analysisId, tenantId);
    if (!completed) {
      throw Object.assign(new Error("Analysis record not found after pipeline"), {
        code: "INTERNAL_CRASH",
        retryable: false,
      });
    }

    const result = completed.result as Record<string, unknown> | null;
    stream.progress(100, "Done");

    log.info("Patent analysis completed", {
      analysisId,
      status: completed.status,
      score: completed.novelty_score,
      ms: Date.now() - t0,
    });
    if (completed.novelty_score != null) {
      metric.gauge("novelty_score", completed.novelty_score);
    }

    return {
      output: {
        analysisId,
        status: completed.status,
        score: completed.novelty_score ?? undefined,
        verdict: completed.verdict ?? undefined,
        summary: (result?.summary as string | undefined) ?? undefined,
        claims: (result?.claims as unknown[] | undefined) ?? undefined,
        matches: (result?.matches as unknown[] | undefined) ?? undefined,
      },
    };
  },
});

const port = Number(process.env.CATELOG_PORT ?? 3018);
agent.listen(port);
