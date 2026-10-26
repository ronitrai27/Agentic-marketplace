import "dotenv/config";
import { runJobFit } from "./agent.js";

// usage: pnpm start "remote backend roles" [resume.pdf|resume.docx]
const [q, resumePath] = process.argv.slice(2);
if (!q) {
  console.error('usage: pnpm start "<query>" [resume.pdf|resume.docx]');
  process.exit(1);
}
const { output, costUsd } = await runJobFit({ query: q, resumePath }, (s) => console.error(`  • ${s}`));
console.log(JSON.stringify(output, null, 2));
console.error(`cost: $${costUsd.toFixed(4)}`);
