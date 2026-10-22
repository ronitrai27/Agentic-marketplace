import { checkBanList, BanListResult } from "./ban-list.js";
import { analyzeAndRedactPii, PiiAnalysisResult } from "./pii-analyzer.js";
import { analyzeJailbreakHeuristics, JailbreakAnalysisResult } from "./jailbreak-heuristics.js";
import { evaluateSemanticGuard, SemanticGuardDecision } from "./jev-semantic-guard.js";

export * from "./ban-list.js";
export * from "./pii-analyzer.js";
export * from "./jailbreak-heuristics.js";
export * from "./jev-semantic-guard.js";

export interface GuardrailResult {
  isAllowed: boolean;
  sanitizedPrompt: string;
  rejectionReason?: string;
  totalDurationMs: number;
  breakdown: {
    inMemoryDurationMs: number;
    semanticDurationMs: number;
  };
  flags: {
    bannedWords: string[];
    hasPii: boolean;
    piiFindingsCount: number;
    jailbreakDetected: boolean;
    jailbreakRules: string[];
    toxicityScore: number;
    injectionScore: number;
    evaluationSource: string;
  };
}

/**
 * Enterprise Multi-Layered Guardrail Engine.
 * 
 * Pipeline:
 * 1. Fuzzy Ban List (Anti-evasion normalizer) -> Instant reject < 5ms
 * 2. Presidio-Grade PII Redactor (Luhn Credit Cards, SSN, Phone, Email, Keys) -> < 8ms
 * 3. Jailbreak & Prompt Injection Heuristic Matrix -> Instant reject < 10ms
 * 4. JEV / Groq Semantic Safety Classifier (Strict 450ms timeout)
 * 
 * Total Latency Budget: Bounded to < 500-600ms.
 */
export async function evaluateGuardrails(rawPrompt: string): Promise<GuardrailResult> {
  const globalStart = performance.now();

  // ----------------------------------------------------
  // Phase 1: In-Memory Fast Tier (< 15ms total)
  // ----------------------------------------------------
  const inMemoryStart = performance.now();

  // 1. Ban List Check
  const banCheck = checkBanList(rawPrompt);
  if (banCheck.hasBannedWord) {
    const duration = Math.round(performance.now() - globalStart);
    return {
      isAllowed: false,
      sanitizedPrompt: rawPrompt,
      rejectionReason: `Blocked by Ban List: detected disallowed content [${banCheck.matchedWords.join(", ")}]`,
      totalDurationMs: duration,
      breakdown: {
        inMemoryDurationMs: duration,
        semanticDurationMs: 0,
      },
      flags: {
        bannedWords: banCheck.matchedWords,
        hasPii: false,
        piiFindingsCount: 0,
        jailbreakDetected: false,
        jailbreakRules: [],
        toxicityScore: 1.0,
        injectionScore: 0.0,
        evaluationSource: "in-memory-ban-list",
      },
    };
  }

  // 2. Presidio-Grade PII Detection & Redaction
  const piiResult = analyzeAndRedactPii(rawPrompt);
  const cleanPrompt = piiResult.redactedText;

  // 3. Jailbreak & Heuristic Injection Scanner
  const jailbreakResult = analyzeJailbreakHeuristics(cleanPrompt);
  if (jailbreakResult.isJailbreak) {
    const duration = Math.round(performance.now() - globalStart);
    return {
      isAllowed: false,
      sanitizedPrompt: cleanPrompt,
      rejectionReason: `Blocked by Jailbreak Guard: detected adversarial pattern [${jailbreakResult.triggeredRules.join(", ")}]`,
      totalDurationMs: duration,
      breakdown: {
        inMemoryDurationMs: duration,
        semanticDurationMs: 0,
      },
      flags: {
        bannedWords: [],
        hasPii: piiResult.hasPii,
        piiFindingsCount: piiResult.findings.length,
        jailbreakDetected: true,
        jailbreakRules: jailbreakResult.triggeredRules,
        toxicityScore: 0.0,
        injectionScore: jailbreakResult.score,
        evaluationSource: "in-memory-jailbreak-heuristics",
      },
    };
  }

  const inMemoryDurationMs = Math.round(performance.now() - inMemoryStart);

  // ----------------------------------------------------
  // Phase 2: Semantic AI Tier (JEV / Groq Fast Guardrail)
  // ----------------------------------------------------
  const semanticDecision = await evaluateSemanticGuard(cleanPrompt, 450);
  const totalDurationMs = Math.round(performance.now() - globalStart);

  return {
    isAllowed: semanticDecision.isAllowed,
    sanitizedPrompt: cleanPrompt,
    rejectionReason: semanticDecision.rejectionReason,
    totalDurationMs,
    breakdown: {
      inMemoryDurationMs,
      semanticDurationMs: semanticDecision.durationMs,
    },
    flags: {
      bannedWords: [],
      hasPii: piiResult.hasPii,
      piiFindingsCount: piiResult.findings.length,
      jailbreakDetected: false,
      jailbreakRules: [],
      toxicityScore: semanticDecision.toxicityScore,
      injectionScore: semanticDecision.injectionScore,
      evaluationSource: semanticDecision.source,
    },
  };
}
