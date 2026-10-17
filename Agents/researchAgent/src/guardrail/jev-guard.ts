import { ENV } from "../config/env.js";

export interface GuardrailDecision {
  isAllowed: boolean;
  needsResearch: boolean;
  rejectionReason?: string;
  scores: {
    inappropriateProb: number;
    needsResearchProb: number;
  };
}

/**
 * JEV-based input guardrail and intent router using TypeSafe JEV-1.14 decisions API
 */
export async function evaluateInputGuardrail(promptText: string): Promise<GuardrailDecision> {
  if (!ENV.OPENROUTER_JEV) {
    console.warn("[Guardrail] OPENROUTER_JEV missing, bypassing guardrail default=pass.");
    return {
      isAllowed: true,
      needsResearch: true,
      scores: { inappropriateProb: 0, needsResearchProb: 1.0 },
    };
  }

  try {
    const response = await fetch("https://openrouter.ai/api/alpha/decisions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${ENV.OPENROUTER_JEV}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: ENV.JEV_MODEL,
        state: {
          user_prompt: promptText,
        },
        questions: {
          is_inappropriate: {
            type: "noul",
            instructions: "Is this prompt offensive, sexually explicit, abusive, harassing, hateful, or physically disturbing?",
            criteria: {
              true: "Contains toxicity, hate speech, explicit sexual content, violence, or dangerous harassment.",
              false: "Safe and benign user communication."
            }
          },
          needs_research: {
            type: "noul",
            instructions: "Does this prompt require multi-source deep web research, market data, deep technical exploration, or comprehensive fact retrieval?",
            criteria: {
              true: "In-depth investigation, technical analysis, market synthesis, or multi-faceted research.",
              false: "Casual greeting, conversational banter ('hi', 'who are you', 'tell me a joke'), or a simple direct question requiring an immediate answer."
            }
          }
        }
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      console.warn(`[Guardrail] JEV decisions returned ${response.status}: ${errText}`);
      // Fail-open for benign research if JEV API has a momentary hiccup
      return {
        isAllowed: true,
        needsResearch: true,
        scores: { inappropriateProb: 0, needsResearchProb: 0.9 },
      };
    }

    const result = await response.json();
    const inappropriateProb = result.answers?.is_inappropriate?.noul ?? 0.0;
    const needsResearchProb = result.answers?.needs_research?.noul ?? 0.9;

    const isAllowed = inappropriateProb < ENV.JEV_OFFENSIVE_THRESHOLD;
    const needsResearch = needsResearchProb >= ENV.JEV_RESEARCH_THRESHOLD;

    return {
      isAllowed,
      needsResearch,
      rejectionReason: !isAllowed
        ? "Your request was flagged by safety guardrails for potentially offensive, inappropriate, or policy-violating content."
        : undefined,
      scores: {
        inappropriateProb,
        needsResearchProb,
      },
    };
  } catch (error) {
    console.error("[Guardrail] Error evaluating JEV decisions:", error);
    return {
      isAllowed: true,
      needsResearch: true,
      scores: { inappropriateProb: 0, needsResearchProb: 1.0 },
    };
  }
}
