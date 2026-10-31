import "dotenv/config";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { AgentStream, AgentUsage, UsageRecord } from "catelog";
import { runReport } from "./agent.js";
import { InputSchema } from "./schema.js";

// CLI (no server): pnpm start instant|detailed pdf|docx "topic" [source.pdf|source.docx]
const [mode, format, topic, filePath] = process.argv.slice(2);
if (!mode || !format) {
  console.error('usage: pnpm start <instant|detailed> <pdf|docx> "<topic>" [source.pdf|source.docx]');
  process.exit(1);
}

const say = (m: string) => console.error(`  • ${m}`);
const stream: AgentStream = {
  progress: (_p, m) => m && say(m),
  delta: (t) => process.stderr.write(t),
  chunk: () => {},
  write: () => {},
  activity: () => {},
  step: say,
  emit: () => {},
  isClosed: () => false,
};

const records: UsageRecord[] = [];
const usage: AgentUsage = { record: (u) => void records.push(u) };

const input = InputSchema.parse({
  mode,
  output_format: format,
  topic,
  file_base64: filePath ? (await readFile(filePath)).toString("base64") : undefined,
  file_name: filePath ? path.basename(filePath) : undefined,
});

const out = await runReport(input, { runId: `cli-${Date.now()}`, stream, usage, signal: new AbortController().signal });
console.error("\n");
console.log(`${out.title} (${out.char_count} chars, ${out.word_count} words) -> out/${out.files[0].filename.split("/").pop()} [${out.files[0].bytes} bytes]`);
for (const r of records) {
  console.error(`model=${r.model} provider=${r.provider} tokens=${JSON.stringify(r.tokens)}`);
}
