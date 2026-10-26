import "dotenv/config";
import { runJobFit } from "./agent.js";
import { parseResumeFile } from "./parse.js";

// CLI (no server): pnpm start "remote backend roles" [resume.pdf|resume.docx]
const [q, resumePath] = process.argv.slice(2);
if (!q) {
  console.error('usage: pnpm start "<query>" [resume.pdf|resume.docx]');
  process.exit(1);
}
const resumeText = resumePath ? await parseResumeFile(resumePath) : undefined;
const { output, telemetry } = await runJobFit(
  { query: q, resumeText },
  { onStep: (s) => console.error(`  • ${s}`), onTool: (n, i) => console.error(`  • ${n}: ${JSON.stringify(i).slice(0, 100)}`) },
);
console.log(JSON.stringify(output, null, 2));
console.error(
  `model=${telemetry.model_used} tokens=${telemetry.llm_tokens.total} (in ${telemetry.llm_tokens.prompt} / out ${telemetry.llm_tokens.completion}) cost=$${telemetry.cost_usd.toFixed(4)}`,
);
