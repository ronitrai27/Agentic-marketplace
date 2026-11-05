/**
 * Presidio-Grade Native PII Analyzer and Redaction Engine in TypeScript.
 * Detects Credit Cards (validated via Luhn algorithm), SSNs, Emails, Phones, and API Secrets.
 * Target execution time: < 8ms.
 */

export type PiiEntityType =
  | "CREDIT_CARD"
  | "EMAIL_ADDRESS"
  | "PHONE_NUMBER"
  | "US_SSN"
  | "API_KEY_OR_SECRET";

export interface PiiFinding {
  entityType: PiiEntityType;
  originalText: string;
  startIndex: number;
  endIndex: number;
  confidence: number;
}

export interface PiiAnalysisResult {
  hasPii: boolean;
  redactedText: string;
  findings: PiiFinding[];
}

/**
 * Validates credit card number candidates using the Luhn checksum algorithm (Mod 10).
 * Prevents false positives from order numbers, ISBNs, or random digit sequences.
 */
export function isValidLuhn(cardNumber: string): boolean {
  const digits = cardNumber.replace(/\D/g, "");
  if (digits.length < 13 || digits.length > 19) return false;

  let sum = 0;
  let isAlternate = false;

  for (let i = digits.length - 1; i >= 0; i--) {
    let n = parseInt(digits.charAt(i), 10);
    if (isAlternate) {
      n *= 2;
      if (n > 9) {
        n -= 9;
      }
    }
    sum += n;
    isAlternate = !isAlternate;
  }

  return sum % 10 === 0;
}

// Regex recognizers
const REGEX_EMAIL = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
const REGEX_PHONE = /(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g;
const REGEX_SSN = /\b\d{3}[- ]?\d{2}[- ]?\d{4}\b/g;
const REGEX_CREDIT_CARD_CANDIDATE = /\b(?:\d{4}[- ]?){3}\d{4}\b|\b\d{13,19}\b/g;
const REGEX_API_KEY = /\b(?:sk-[a-zA-Z0-9_-]{20,}|eyJ[a-zA-Z0-9_-]{15,}\.[a-zA-Z0-9_-]{15,}|gsk_[a-zA-Z0-9_-]{20,})\b/g;

/**
 * Scans text for PII entities, validates mathematical checksums, and produces a redacted string.
 */
export function analyzeAndRedactPii(text: string): PiiAnalysisResult {
  const findings: PiiFinding[] = [];

  // 1. Credit Cards (with Luhn check)
  let match: RegExpExecArray | null;
  while ((match = REGEX_CREDIT_CARD_CANDIDATE.exec(text)) !== null) {
    const rawVal = match[0];
    if (isValidLuhn(rawVal)) {
      findings.push({
        entityType: "CREDIT_CARD",
        originalText: rawVal,
        startIndex: match.index,
        endIndex: match.index + rawVal.length,
        confidence: 0.98,
      });
    }
  }

  // 2. Email Addresses
  while ((match = REGEX_EMAIL.exec(text)) !== null) {
    findings.push({
      entityType: "EMAIL_ADDRESS",
      originalText: match[0],
      startIndex: match.index,
      endIndex: match.index + match[0].length,
      confidence: 0.95,
    });
  }

  // 3. Phone Numbers
  while ((match = REGEX_PHONE.exec(text)) !== null) {
    // Avoid small 4-digit numbers being misclassified
    if (match[0].replace(/\D/g, "").length >= 7) {
      findings.push({
        entityType: "PHONE_NUMBER",
        originalText: match[0],
        startIndex: match.index,
        endIndex: match.index + match[0].length,
        confidence: 0.85,
      });
    }
  }

  // 4. US SSN
  while ((match = REGEX_SSN.exec(text)) !== null) {
    const digitsOnly = match[0].replace(/\D/g, "");
    if (digitsOnly.length === 9 && !digitsOnly.startsWith("000") && !digitsOnly.startsWith("666")) {
      findings.push({
        entityType: "US_SSN",
        originalText: match[0],
        startIndex: match.index,
        endIndex: match.index + match[0].length,
        confidence: 0.90,
      });
    }
  }

  // 5. API Keys and Tokens
  while ((match = REGEX_API_KEY.exec(text)) !== null) {
    findings.push({
      entityType: "API_KEY_OR_SECRET",
      originalText: match[0],
      startIndex: match.index,
      endIndex: match.index + match[0].length,
      confidence: 0.99,
    });
  }

  // Sort findings in descending order of startIndex to perform clean in-place replacement
  findings.sort((a, b) => b.startIndex - a.startIndex);

  let redactedText = text;
  // Filter out overlapping findings
  const nonOverlapping: PiiFinding[] = [];
  let lastStart = Infinity;

  for (const f of findings) {
    if (f.endIndex <= lastStart) {
      nonOverlapping.push(f);
      lastStart = f.startIndex;
      const mask = `<REDACTED_${f.entityType}>`;
      redactedText =
        redactedText.slice(0, f.startIndex) + mask + redactedText.slice(f.endIndex);
    }
  }

  return {
    hasPii: nonOverlapping.length > 0,
    redactedText,
    findings: nonOverlapping.reverse(),
  };
}
