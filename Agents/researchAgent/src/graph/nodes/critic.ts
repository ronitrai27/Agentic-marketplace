import OpenAI from "openai";
import { ENV } from "../../config/env.js";
import { ResearchState } from "../state.js";

const openai = new OpenAI({
  apiKey: ENV.OPENAI_API_KEY || "build_dummy_key",
});

/**
 * Critic Node: Evaluates report coverage, citations, and critical gaps.
 * Enforces a strict bounded loop (max 1 refinement pass) to protect token budget and time.
 */
export async function criticNode(state: ResearchState): Promise<Partial<ResearchState>> {
  console.log(`\n======================================================`);
  console.log(`[Critic: ${ENV.OPENAI_MODEL}] Reviewing section drafts (Round ${state.critiqueCount + 1}/${ENV.MAX_CRITIC_ROUNDS + 1})...`);
  console.log(`======================================================`);

  // Guardrail: If we already performed the maximum critic iterations, skip directly to synthesis
  if (state.critiqueCount >= ENV.MAX_CRITIC_ROUNDS) {
    console.log("[Critic] Maximum refinement rounds reached. Proceeding to final synthesis.");
    return {
      needsMoreResearch: false,
      critiqueCount: state.critiqueCount + 1,
    };
  }

  const sectionsSummary = state.sections
    .map((s) => `### Section: ${s.title}\nFindings Preview:\n${s.findings?.slice(0, 500)}...\nSources: ${s.sources.length} sources\n`)
    .join("\n");

  const prompt = `You are a Chief Scientific Editor reviewing a research report draft on:
Topic: "${state.topic}"

Current Sections:
${sectionsSummary}

Evaluate if there is a severe information gap, missing critical metric, or unaddressed counterpoint that requires one more targeted research pass.
If the content is sufficiently comprehensive, approve it.

Respond strictly in JSON format:
{
  "approved": boolean,
  "feedback": "Concise explanation of what is missing if not approved, or 'Approved' if satisfactory"
}`;

  try {
    const completion = await openai.chat.completions.create({
      model: ENV.OPENAI_MODEL,
      messages: [
        { role: "system", content: "You are a critical reviewer evaluating report rigor. Respond in JSON." },
        { role: "user", content: prompt },
      ],
      response_format: { type: "json_object" },
      temperature: 0.1,
    });

    const parsed = JSON.parse(completion.choices[0]?.message?.content || "{}");
    const approved = parsed.approved ?? true;
    const feedback = parsed.feedback || null;

    console.log(`[Critic] Decision: ${approved ? "APPROVED" : "REFINEMENT NEEDED"}`);
    if (!approved && feedback) {
      console.log(`[Critic Feedback] ${feedback}`);
    }

    return {
      needsMoreResearch: !approved,
      critiqueFeedback: !approved ? feedback : null,
      critiqueCount: state.critiqueCount + 1,
    };
  } catch (err) {
    console.warn("[Critic] Evaluation error, defaulting to approved:", err);
    return {
      needsMoreResearch: false,
      critiqueCount: state.critiqueCount + 1,
    };
  }
}
