/**
 * Heuristic Prompt Injection & Jailbreak Detection Matrix.
 * High-speed pattern analysis for adversarial prompt vectors.
 * Target execution time: < 4ms.
 */

interface JailbreakRule {
  name: string;
  pattern: RegExp;
  weight: number;
}

const JAILBREAK_RULES: JailbreakRule[] = [
  // 1. System directive & prompt override triggers
  {
    name: "Instruction Override",
    pattern: /(?:ignore|disregard|forget|bypass)\s+(?:all\s+)?(?:previous|prior|above|system)\s+(?:instructions|rules|prompts|directives|guidelines)/i,
    weight: 0.85,
  },
  {
    name: "System Directive Forgery",
    pattern: /(?:###\s*system\s*(?:directive|prompt|override)|\[system\s+instruction\]|<\|im_start\|>|<\|system\|>)/i,
    weight: 0.95,
  },

  // 2. Persona & jailbreak role assumptions
  {
    name: "DAN / Jailbreak Persona",
    pattern: /\b(?:you\s+are\s+now\s+(?:dan|developer\s+mode|unrestricted|uncensored|evilbot)|act\s+as\s+dan|do\s+anything\s+now)\b/i,
    weight: 0.90,
  },
  {
    name: "Rule Inversion",
    pattern: /\b(?:no\s+longer\s+bound\s+by|free\s+from\s+all\s+rules|unfiltered\s+mode|disable\s+safety\s+filters)\b/i,
    weight: 0.80,
  },

  // 3. System prompt exfiltration
  {
    name: "Prompt Exfiltration",
    pattern: /(?:reveal|dump|leak|output|print|show\s+me)\s+(?:your\s+)?(?:system\s+(?:prompt|instructions)|hidden\s+rules|developer\s+message)/i,
    weight: 0.75,
  },

  // 4. Obfuscation & Evasion techniques
  {
    name: "Encoding Execution Request",
    pattern: /(?:base64\s+(?:decode|encoded)|rot13|hex\s+encoded)\s+(?:payload|instruction|prompt)/i,
    weight: 0.60,
  },
];

export interface JailbreakAnalysisResult {
  isJailbreak: boolean;
  score: number;
  triggeredRules: string[];
}

/**
 * Evaluates whether text contains prompt injection or jailbreak attempts.
 */
export function analyzeJailbreakHeuristics(
  text: string,
  threshold = 0.70
): JailbreakAnalysisResult {
  const triggered: string[] = [];
  let maxScore = 0.0;
  let accumulatedScore = 0.0;

  for (const rule of JAILBREAK_RULES) {
    if (rule.pattern.test(text)) {
      triggered.push(rule.name);
      maxScore = Math.max(maxScore, rule.weight);
      accumulatedScore += rule.weight * 0.5;
    }
  }

  // Combined score normalized up to 1.0
  const finalScore = Math.min(1.0, maxScore + (triggered.length > 1 ? 0.15 : 0.0));
  const isJailbreak = finalScore >= threshold;

  return {
    isJailbreak,
    score: parseFloat(finalScore.toFixed(3)),
    triggeredRules: triggered,
  };
}
