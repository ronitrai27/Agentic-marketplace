import type { AgentStream, AgentUsage } from "catelog";
import type { ReportInput, ReportOutput } from "./schema.js";
import { anthropicApiKey, groqApiKey } from "./config.js";
import { readSource, type SourceDoc } from "./source.js";
import { MAX_CHARS, MIN_CHARS, runDepth, runFast } from "./modes.js";
import { deliverFile, renderFile } from "./files.js";
import { fitLength, titleOf, wordCount } from "./render/markdown.js";
import { depthWarmup, offsetProgress } from "./depth.js";

export class ConfigError extends Error {
  readonly retryable = false;
  constructor(
    message: string,
    readonly code = "MODEL_AUTH_FAILED",
  ) {
    super(message);
    this.name = "ConfigError";
  }
}

/** Fast needs Groq; depth needs Groq and Claude. */
function requireKeys(tier: ReportInput["tier"]): void {
  const missing = [
    ["GROQ_API_KEY", groqApiKey()],
    ...(tier === "depth" ? [["ANTHROPIC_API_KEY", anthropicApiKey()]] : []),
  ].filter(([, v]) => !v);
  if (missing.length) {
    throw new ConfigError(`The ${tier} tier is not configured on this agent (missing ${missing.map(([k]) => k).join(", ")})`);
  }
}

export interface RunOptions {
  runId: string;
  stream: AgentStream;
  usage: AgentUsage;
  signal: AbortSignal;
}

export async function runReport(input: ReportInput, run: RunOptions): Promise<ReportOutput> {
  requireKeys(input.tier);

  // Depth tier: ~2 min of preparation with live progress first; fast tier goes straight to work.
  let o = run;
  if (input.tier === "depth") {
    await depthWarmup(run.stream, run.signal);
    o = { ...run, stream: offsetProgress(run.stream) };
  }

  // Remember which models actually ran so the result can show them.
  const used = new Map<string, { id: string; provider?: string }>();
  const usage: AgentUsage = {
    record: (u) => {
      used.set(`${u.provider}/${u.model}`, { id: u.model, provider: u.provider });
      o.usage.record(u);
    },
  };

  let source: SourceDoc | undefined;
  if (input.file_base64) {
    o.stream.progress(3, "Reading your document");
    source = await readSource(input.file_base64, input.file_name ?? "document.pdf");
  }

  const ctx = { topic: input.topic, source, usage, stream: o.stream, signal: o.signal };
  const result = input.tier === "depth" ? await runDepth(ctx) : await runFast(ctx);
  const markdown = fitLength(result.markdown, MAX_CHARS, MIN_CHARS);
  if (!markdown) throw Object.assign(new Error("The model returned an empty report"), { code: "INTERNAL_CRASH", retryable: true });

  const title = titleOf(markdown, input.topic.slice(0, 80));
  const models = [...used.values()];

  // The footer lives in the file only, so the report text itself stays within the character budget.
  const date = new Date().toISOString().slice(0, 10);
  const footer = `_Generated on ${date} by Report Agent (${input.tier} tier) using ${models.map((m) => m.id).join(", ")}._`;

  o.stream.progress(92, `Building the ${input.output_format.toUpperCase()} file`);
  const file = await renderFile(input.output_format, `${markdown}\n\n${footer}`, title);
  const delivered = await deliverFile(file, o.runId);

  o.stream.progress(100, "Done");
  return {
    title,
    report: markdown,
    char_count: markdown.length,
    word_count: wordCount(markdown),
    tier: input.tier,
    models_used: models,
    sources: result.sources.slice(0, 10),
    files: [delivered],
  };
}
