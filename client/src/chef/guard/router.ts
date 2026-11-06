import type { JevResponse } from "./jev";

/**
 * Pure routing over Jev's answers. Thresholds are tuned for jev-1.14: re-tune them if the model changes.
 * Noul values are probabilities of "yes"; compare them against bands, never against exact numbers.
 */
export const THRESHOLDS = {
  /** jailbreak / hijack at or above this: refuse. */
  block: 0.7,
  /** jailbreak / hijack between this and `block`: allow, but with the hardened prompt on the heavy model. */
  suspicious: 0.3,
  /** in_scope below this, with no task in progress: refuse. */
  inScopeMin: 0.6,
  /** chitchat probability needed to use the instant model. */
  chitchatMin: 0.8,
} as const;

export type GuardAction = "allow" | "block";
export type GuardDecision = {
  action: GuardAction;
  /** instant = GPT_INSTANT_MODEL (small talk), heavy = GPT_HEAVY_MODEL (tools and tasks). */
  model: "instant" | "heavy";
  /** Use the hardened system prompt downstream. */
  hardened: boolean;
  reason: string;
  scores: { jailbreak: number; hijack: number; inScope: number; chitchat: number } | null;
};

/** The phases where the user is mid-task, so short replies are expected and the heavy model is required. */
const ACTIVE_PHASES = new Set(["clarify", "choose", "prepare", "confirm", "running"]);

export function decide(res: JevResponse | null, phase: string): GuardDecision {
  const active = ACTIVE_PHASES.has(phase);

  // Jev down or malformed: fail closed (strongest model, hardened prompt), never silently open.
  const jailbreak = res?.answers.jailbreak;
  const hijack = res?.answers.hijack;
  const inScope = res?.answers.in_scope;
  const route = res?.answers.route;
  if (
    !res ||
    jailbreak?.type !== "noul" ||
    hijack?.type !== "noul" ||
    inScope?.type !== "noul" ||
    route?.type !== "choice"
  ) {
    return { action: "allow", model: "heavy", hardened: true, reason: "jev_unavailable", scores: null };
  }

  const scores = {
    jailbreak: jailbreak.noul,
    hijack: hijack.noul,
    inScope: inScope.noul,
    chitchat: route.probabilities.chitchat ?? 0,
  };

  if (scores.jailbreak >= THRESHOLDS.block) return { action: "block", model: "heavy", hardened: true, reason: "jailbreak", scores };
  if (scores.hijack >= THRESHOLDS.block) return { action: "block", model: "heavy", hardened: true, reason: "hijack", scores };
  if (!active && scores.inScope < THRESHOLDS.inScopeMin) {
    return { action: "block", model: "heavy", hardened: true, reason: "out_of_scope", scores };
  }

  const suspicious = scores.jailbreak >= THRESHOLDS.suspicious || scores.hijack >= THRESHOLDS.suspicious;
  if (suspicious) return { action: "allow", model: "heavy", hardened: true, reason: "suspicious", scores };

  const instant = !active && scores.chitchat >= THRESHOLDS.chitchatMin;
  return { action: "allow", model: instant ? "instant" : "heavy", hardened: false, reason: instant ? "chitchat" : "task", scores };
}
