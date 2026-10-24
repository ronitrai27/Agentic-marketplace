import OpenAI from "openai";
import { ENV } from "../../config/env.js";
import { ResearchSection, ResearchSource } from "../state.js";
import { searchWeb } from "../../tools/search.js";
import { scrapePage } from "../../tools/firecrawl.js";
import { notifyProgress } from "../../observability/progress.js";

const openai = new OpenAI({
  apiKey: ENV.OPENAI_API_KEY || "build_dummy_key",
});

/**
 * Worker Node: Researches a single section in parallel.
 * Executes search queries -> scrapes clean markdown via Firecrawl -> drafts section via gpt-4.1-mini.
 */
export async function sectionWorkerNode(input: { section: ResearchSection }) {
  const { section } = input;
  console.log(`\n--> [Worker: ${section.id}] Starting deep research: "${section.title}"`);
  notifyProgress(`🚀 [Worker: ${section.id}] Researching section: "${section.title}"`);

  const collectedSources: ResearchSource[] = [];
  const sourceContents: { title: string; url: string; markdown: string }[] = [];

  // 1. Execute searches for the section
  for (const query of section.searchQueries.slice(0, ENV.MAX_QUERIES_PER_SECTION)) {
    const searchResults = await searchWeb(query, ENV.MAX_SCRAPE_PER_QUERY);

    for (const result of searchResults) {
      // Avoid duplicate scrapes within this section
      if (sourceContents.some((s) => s.url === result.url)) continue;

      const page = await scrapePage(result.url, result.title);
      if (page.success && page.markdown.length > 0) {
        sourceContents.push({
          title: page.title || result.title,
          url: page.url,
          markdown: page.markdown,
        });
        collectedSources.push({
          title: page.title || result.title,
          url: page.url,
        });
      }
    }
  }

  console.log(
    `[Worker: ${section.id}] Gathered ${sourceContents.length} scraped sources. Generating section draft...`
  );

  // 2. Synthesize Section Draft with gpt-4.1-mini
  const sourcesContext = sourceContents.length > 0
    ? sourceContents
        .map(
          (s, idx) =>
            `--- Source ${idx + 1}: ${s.title} (${s.url}) ---\n${s.markdown.slice(0, 4000)}\n`
        )
        .join("\n")
    : "No external scraped content retrieved. Rely on deep analytical synthesis and verify logical structure.";

  const prompt = `You are an expert researcher writing an in-depth analytical section for a comprehensive report.

SECTION TITLE: "${section.title}"
SECTION OBJECTIVE: "${section.description}"

EVIDENCE & RETRIEVED SOURCES:
${sourcesContext}

REQUIREMENTS:
1. Provide an extensive, data-rich analytical synthesis (400-700 words).
2. Incorporate concrete facts, figures, dates, and named entities where present.
3. Every factual claim MUST include inline markdown citations pointing to the source URL, formatted as: [Source Title](URL).
4. Organize into clear subsections or bullet points with markdown formatting.
5. Highlight trade-offs, market impacts, or technical implications.

Draft the complete section now:`;

  const completion = await openai.chat.completions.create({
    model: ENV.OPENAI_MODEL,
    messages: [
      {
        role: "system",
        content: "You are a senior analyst drafting a section of an authoritative research paper.",
      },
      { role: "user", content: prompt },
    ],
    temperature: 0.3,
  });

  const findings = completion.choices[0]?.message?.content || "No findings generated.";

  console.log(`[Worker: ${section.id}] Completed section draft (${findings.length} chars).`);
  notifyProgress(`✍️ [Worker: ${section.id}] Drafted section: "${section.title}" (${findings.length} chars)`);

  return {
    sections: [
      {
        ...section,
        findings,
        sources: collectedSources,
      },
    ],
    llmTokens: {
      prompt: completion.usage?.prompt_tokens || 0,
      completion: completion.usage?.completion_tokens || 0,
      total: completion.usage?.total_tokens || 0,
    },
  };
}
