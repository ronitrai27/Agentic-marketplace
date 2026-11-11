import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import { consoleReporter } from "./events.js";
import { huntJobs } from "./loop.js";
import { parseResumeFile } from "./parse.js";

// pnpm start "senior typescript backend, remote" [resume.pdf|docx] [--location "Berlin, Germany"]
const args = process.argv.slice(2);
const li = args.indexOf("--location");
const location = li >= 0 ? args.splice(li, 2)[1] : undefined;
const [query, resumePath] = args;
if (!query) {
  console.error('usage: pnpm start "<role/query>" [resume.pdf|docx] [--location "City, Country"]');
  process.exit(1);
}
for (const k of ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "SERPAPI_KEY"]) {
  if (!process.env[k]) {
    console.error(`Missing ${k} in .env`);
    process.exit(1);
  }
}

const resume = resumePath ? await parseResumeFile(resumePath) : "";
const rep = consoleReporter();
const r = await huntJobs(rep, query, resume, location);
const u = rep.totals();

console.log(
  `\n${r.jobs.length} jobs (${r.stats.rounds} rounds, ${r.stats.seconds}s, ${r.stats.fetched} postings checked, ${r.stats.serp_calls} SerpAPI calls, ${u.calls} LLM calls, ${u.prompt}+${u.completion} tokens)\n`,
);
r.jobs.forEach((j, i) => {
  console.log(`${i + 1}. [${j.score}]${j.partial ? " (partial match)" : ""} ${j.title} - ${j.company} (${j.location}) [${j.source}]`);
  console.log(`   ${j.url}\n   why: ${j.why_fits}`);
  if (j.missing_keywords.length) console.log(`   add: ${j.missing_keywords.join(", ")}`);
});
console.log("\nKeywords for your resume:");
console.log("  already strong:", r.resume_keywords.have.map((k) => `${k.term}(${k.jobs})`).join(", ") || "-");
console.log("  add:", r.resume_keywords.add.map((k) => `${k.term}(${k.jobs})`).join(", ") || "-");

await mkdir("out", { recursive: true });
const file = `out/result-${Date.now()}.json`;
await writeFile(file, JSON.stringify(r, null, 2));
console.log(`\nSaved ${file}`);
