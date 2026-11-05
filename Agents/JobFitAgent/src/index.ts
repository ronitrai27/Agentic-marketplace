import "dotenv/config";
import type { AgentStream } from "catelog";
import { runJobFit } from "./agent.js";
import { parseResumeFile } from "./parse.js";

// CLI (no server): pnpm start "remote backend roles" [resume.pdf|resume.docx]
const [q, resumePath] = process.argv.slice(2);
if (!q) {
  console.error('usage: pnpm start "<query>" [resume.pdf|resume.docx]');
  process.exit(1);
}

const say = (m: string) => console.error(`  • ${m}`);
const consoleStream: AgentStream = {
  progress: (_p, m) => m && say(m),
  delta: () => {},
  chunk: () => {},
  write: () => {},
  activity: (type, data) => say(`${type} ${JSON.stringify(data).slice(0, 100)}`),
  step: say,
  emit: () => {},
  isClosed: () => false,
};

const resumeText = resumePath ? await parseResumeFile(resumePath) : undefined;
const { output, telemetry } = await runJobFit({ prompt: q, resumeText }, consoleStream);
console.log(JSON.stringify(output, null, 2));
console.error(
  `model=${telemetry?.model_used} tokens=${telemetry?.llm_tokens?.total} (in ${telemetry?.llm_tokens?.prompt} / out ${telemetry?.llm_tokens?.completion}) cost=$${telemetry?.cost_usd?.toFixed(4)}`,
);
