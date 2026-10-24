import OpenAI from "openai";
import { ENV } from "../../config/env.js";
import { ResearchState, ResearchSection } from "../state.js";
import { notifyProgress } from "../../observability/progress.js";

const openai = new OpenAI({
  apiKey: ENV.OPENAI_API_KEY || "build_dummy_key",
});

/**
 * Orchestrator Node: Decomposes the topic into 3 distinct sections with targeted search queries.
 * Powered by gpt-4.1-mini
 */
export async function orchestratorNode(state: ResearchState): Promise<Partial<ResearchState>> {
  console.log(`\n======================================================`);
  console.log(`[Orchestrator: ${ENV.OPENAI_MODEL}] Planning research for: "${state.topic}"`);
  console.log(`======================================================`);
  notifyProgress(`🧠 [Lead Orchestrator] Architecting 3 research streams with targeted search vectors...`);

  const feedbackContext = state.critiqueFeedback
    ? `\nPREVIOUS CRITIQUE FEEDBACK (Address these missing points):\n${state.critiqueFeedback}\n`
    : "";

  const prompt = `You are a Principal Research Architect.
Your task is to plan a focused, rigorous deep research investigation for the following topic:

Topic: "${state.topic}"
${feedbackContext}

Divide this research into exactly 3 core analytical sections.
For each section, provide:
- id: A concise key like "sec_1", "sec_2", "sec_3"
- title: A descriptive section title
- description: Specific questions and empirical data to uncover
- searchQueries: Exactly 2 precise, keyword-rich search queries optimized for search engines

Respond with a valid JSON object matching this schema:
{
  "sections": [
    {
      "id": "sec_1",
      "title": "Section Title",
      "description": "What to investigate",
      "searchQueries": ["query 1", "query 2"]
    }
  ]
}`;

  const completion = await openai.chat.completions.create({
    model: ENV.OPENAI_MODEL,
    messages: [
      { role: "system", content: "You are a research planning assistant that outputs strict JSON." },
      { role: "user", content: prompt },
    ],
    response_format: { type: "json_object" },
    temperature: 0.2,
  });

  const content = completion.choices[0]?.message?.content || "{}";
  let parsed: { sections?: any[] } = {};

  try {
    parsed = JSON.parse(content);
  } catch (err) {
    console.error("[Orchestrator] Failed to parse JSON, using fallback outline:", err);
  }

  const rawSections = parsed.sections || [];
  const sections: ResearchSection[] = rawSections.slice(0, ENV.MAX_SECTIONS).map((s, idx) => ({
    id: s.id || `sec_${idx + 1}`,
    title: s.title || `Analytical Dimension ${idx + 1}`,
    description: s.description || "In-depth investigation",
    searchQueries: Array.isArray(s.searchQueries) ? s.searchQueries.slice(0, 2) : [`${state.topic} analysis`],
    sources: [],
  }));

  console.log(`[Orchestrator] Generated ${sections.length} research sections:`);
  sections.forEach((s) => {
    console.log(`  - [${s.id}] ${s.title} (Queries: ${s.searchQueries.join(" | ")})`);
  });

  return {
    sections,
    critiqueFeedback: null,
  };
}
