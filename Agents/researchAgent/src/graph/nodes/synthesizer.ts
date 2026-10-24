import OpenAI from "openai";
import { ENV } from "../../config/env.js";
import { ResearchState } from "../state.js";
import { notifyProgress } from "../../observability/progress.js";

const openai = new OpenAI({
  apiKey: ENV.OPENAI_API_KEY || "build_dummy_key",
});

/**
 * Synthesizer Node: Compiles all researched sections into a publication-grade markdown report.
 * Powered by gpt-4.1-mini.
 */
export async function synthesizerNode(state: ResearchState): Promise<Partial<ResearchState>> {
  console.log(`\n======================================================`);
  console.log(`[Synthesizer: ${ENV.OPENAI_MODEL}] Compiling final executive research report...`);
  console.log(`======================================================`);
  notifyProgress(`📊 [Synthesizer: ${ENV.OPENAI_MODEL}] Compiling final executive whitepaper report...`);

  // Collect and deduplicate all sources across all sections
  const allSourcesMap = new Map<string, string>();
  for (const sec of state.sections) {
    for (const src of sec.sources) {
      if (src.url && !allSourcesMap.has(src.url)) {
        allSourcesMap.set(src.url, src.title || "External Reference");
      }
    }
  }

  const sectionsContent = state.sections
    .map(
      (sec, i) =>
        `## Section ${i + 1}: ${sec.title}\n\n${sec.findings || "No findings recorded."}\n`
    )
    .join("\n\n---\n\n");

  const sourcesList = Array.from(allSourcesMap.entries())
    .map(([url, title], idx) => `${idx + 1}. [${title}](${url})`)
    .join("\n");

  const prompt = `You are an Executive Research Editor.
Compile and polish the following researched sections into an authoritative, beautifully formatted whitepaper report on:

TOPIC: "${state.topic}"

DRAFT SECTIONS:
${sectionsContent}

RETRIEVED REFERENCES:
${sourcesList || "Synthesized analysis from verified domain sources."}

STRUCTURE OF THE REPORT:
# Executive Research Report: ${state.topic}

> **Executive Brief:** 3-4 sentence high-impact summary.

## Key Strategic Findings & Metrics
- Bulleted takeaways highlighting concrete statistics, timelines, and implications.

${sectionsContent}

## Strategic Outlook & Risks
- Critical uncertainties, regulatory hurdles, or future breakthroughs to watch.

## Comprehensive Bibliography & Sources
${sourcesList}

Ensure the report is rigorous, coherent, fluidly written, and preserves all inline markdown hyperlinks.`;

  const completion = await openai.chat.completions.create({
    model: ENV.OPENAI_MODEL,
    messages: [
      {
        role: "system",
        content: "You are an executive research report synthesizer. You output pristine GitHub-flavored markdown.",
      },
      { role: "user", content: prompt },
    ],
    temperature: 0.3,
  });

  const finalReport = completion.choices[0]?.message?.content || "# Research Report\n\nFailed to synthesize content.";

  console.log(`[Synthesizer] Generated final report (${finalReport.length} characters).`);
  notifyProgress(`🎉 Generated final executive research report (${finalReport.length} characters).`);

  return {
    finalReport,
    llmTokens: {
      prompt: completion.usage?.prompt_tokens || 0,
      completion: completion.usage?.completion_tokens || 0,
      total: completion.usage?.total_tokens || 0,
    },
  };
}
