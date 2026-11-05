/**
 * Ban List with Fuzzy Matching and Anti-Evasion Normalization.
 * Execution target: < 3ms.
 */

// Normalized leetspeak translation table
const LEET_MAP: Record<string, string> = {
  "@": "a",
  "4": "a",
  "8": "b",
  "3": "e",
  "1": "i",
  "!": "i",
  "|": "l",
  "0": "o",
  "5": "s",
  "$": "s",
  "7": "t",
  "+": "t",
  "v": "u",
  "w": "vv",
};

// Default high-severity banned word list (profanity, slurs, exploits)
export const DEFAULT_BANNED_WORDS = [
  "fuck",
  "fucking",
  "shit",
  "bitch",
  "asshole",
  "bastard",
  "nigger",
  "faggot",
  "retard",
  "kill yourself",
  "ddos attack",
  "drop database",
  "rm -rf",
  "zero-day exploit",
  "sql injection",
];

/**
 * Normalizes input string by:
 * 1. Lowercasing
 * 2. Translating leetspeak characters
 * 3. Collapsing repeated characters (e.g. "fuuuuck" -> "fuck")
 * 4. Stripping extraneous punctuation inside words
 */
export function normalizeText(text: string): string {
  let normalized = text.toLowerCase();

  // Replace leet characters
  let translated = "";
  for (const char of normalized) {
    translated += LEET_MAP[char] ?? char;
  }
  normalized = translated;

  // Remove interior separator characters (e.g., "f.u.c.k" or "f*u*c*k")
  normalized = normalized.replace(/[\*\.\_\-\#\@\$\%\^\&\(\)]+/g, "");

  // Collapse 3+ repeating characters to 1 (e.g., "fuuuuck" -> "fuck")
  normalized = normalized.replace(/(.)\1{2,}/g, "$1");

  return normalized;
}

/**
 * Fast Levenshtein distance algorithm (O(N*M))
 */
export function levenshteinDistance(a: string, b: string): number {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const matrix: number[][] = [];

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }

  for (let j = 0; j <= a.length; j++) {
    matrix[0]![j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i]![j] = matrix[i - 1]![j - 1]!;
      } else {
        matrix[i]![j] = Math.min(
          matrix[i - 1]![j - 1]! + 1, // substitution
          Math.min(
            matrix[i]![j - 1]! + 1, // insertion
            matrix[i - 1]![j]! + 1 // deletion
          )
        );
      }
    }
  }

  return matrix[b.length]![a.length]!;
}

export interface BanListResult {
  hasBannedWord: boolean;
  matchedWords: string[];
  normalizedSample: string;
}

/**
 * Scans text against ban list using exact & fuzzy distance thresholds.
 */
export function checkBanList(
  rawText: string,
  customBannedWords: string[] = DEFAULT_BANNED_WORDS
): BanListResult {
  const normalized = normalizeText(rawText);
  const words = normalized.split(/\s+/).filter(Boolean);
  const matchedWords: string[] = [];

  for (const banned of customBannedWords) {
    const normBanned = normalizeText(banned);

    // 1. Direct substring match on multi-word phrases or words
    if (normalized.includes(normBanned)) {
      matchedWords.push(banned);
      continue;
    }

    // 2. Fuzzy match against individual tokens
    // Allow distance 1 for words length >= 4, distance 2 for words length >= 7
    const maxAllowedDist = normBanned.length >= 7 ? 2 : normBanned.length >= 4 ? 1 : 0;
    if (maxAllowedDist === 0) continue;

    for (const token of words) {
      if (Math.abs(token.length - normBanned.length) > maxAllowedDist) continue;
      const dist = levenshteinDistance(token, normBanned);
      if (dist <= maxAllowedDist) {
        matchedWords.push(`${banned} (fuzzy: "${token}")`);
        break;
      }
    }
  }

  return {
    hasBannedWord: matchedWords.length > 0,
    matchedWords: Array.from(new Set(matchedWords)),
    normalizedSample: normalized.slice(0, 150),
  };
}
