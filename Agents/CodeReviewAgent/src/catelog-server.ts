import "dotenv/config";
import { createAgent } from "catelog";
import { runCodeReview } from "./agent/reviewer.js";
import type { ReviewJob, ReviewResult, SourceFile } from "./agent/types.js";
import { scanPublicRepo, cleanupScan } from "./services/repo.js";

const InputSchema = {
  type: "object" as const,
  required: ["mode", "files"] as const,
  properties: {
    mode: { type: "string", enum: ["paste", "upload", "repo"] },
    language: { type: "string" },
    context: { type: "string" },
    repoUrl: { type: "string", description: "Public repo URL (repo mode only)" },
    files: {
      type: "array",
      items: {
        type: "object",
        required: ["name", "content"],
        properties: {
          name: { type: "string" },
          content: { type: "string" },
        },
      },
      description: "Source files (paste/upload mode)",
    },
  },
};

const OutputSchema = {
  type: "object" as const,
  properties: {
    summary: { type: "string" },
    score: { type: "number", minimum: 0, maximum: 100 },
    verdict: { type: "string", enum: ["approve", "request-changes", "reject"] },
    issues: { type: "array", items: { type: "object" } },
    risks: { type: "array", items: { type: "object" } },
    strengths: { type: "array", items: { type: "string" } },
    recommendations: { type: "array", items: { type: "string" } },
  },
};

export const agent = createAgent<
  { mode: string; language?: string; context?: string; repoUrl?: string; files: SourceFile[] },
  ReviewResult
>({
  id: "code-review-agent",
  name: "Code Review Agent",
  version: "1.0.0",
  description:
    "Paste code, upload files, or point at a GitHub repo URL for a structured AI code review: bugs, security, performance, maintainability.",
  mode: (process.env.REVIEW_MODE ?? "async") as "sync" | "async",
  inputSchema: InputSchema,
  outputSchema: OutputSchema,
  maxTimeoutMinute: 5,
  limits: {
    maxConcurrent: Number(process.env.REVIEW_MAX_CONCURRENT ?? 5),
    maxBodyBytes: 10 * 1024 * 1024,
    rateLimit: { max: Number(process.env.REVIEW_RATE_LIMIT ?? 20), windowMs: 60_000 },
    trustProxy: process.env.TRUST_PROXY === "true",
  },

  async execute({ input, stream, signal, log, metric }) {
    const t0 = Date.now();
    log.info("Code review started", { mode: input.mode });
    metric.count("runs");

    stream.step("Starting code review");
    stream.progress(5, "Preparing review job");

    let repoDir: string | undefined;
    let files: SourceFile[] = input.files ?? [];

    try {
      if (input.mode === "repo") {
        if (!input.repoUrl) {
          throw Object.assign(new Error("repoUrl is required for repo mode"), {
            code: "INVALID_INPUT",
            retryable: false,
          });
        }
        stream.progress(10, "Cloning repository");
        const scan = await scanPublicRepo(input.repoUrl);
        repoDir = scan.dir;
        files = scan.files;
        stream.progress(25, `Scanned ${files.length} files from ${scan.repoName}`);
      }

      const job: ReviewJob = {
        mode: input.mode as ReviewJob["mode"],
        language: input.language ?? null,
        context: input.context ?? null,
        repoUrl: input.repoUrl ?? null,
        files,
      };

      stream.progress(30, "Running AI review");
      const result = await runCodeReview(job);

      stream.progress(95, "Formatting results");
      log.info("Code review completed", {
        verdict: result.verdict,
        score: result.score,
        issues: result.issues.length,
        ms: Date.now() - t0,
      });
      metric.gauge("score", result.score);
      metric.count(`verdict_${result.verdict}`);

      return { output: result };
    } catch (err) {
      const e = err as Error & { code?: string };
      log.error("Code review failed", {
        code: e.code ?? e.name,
        message: e.message,
        ms: Date.now() - t0,
      });
      metric.count("errors");
      throw err;
    } finally {
      if (repoDir) {
        await cleanupScan(repoDir).catch(() => undefined);
      }
    }
  },
});

const port = Number(process.env.CATELOG_PORT ?? 3016);
agent.listen(port);
