/**
 * Novelty scoring — normative implementation of ARCHITECTURE §8.
 * Pure functions: unit-tested, deterministic, no I/O.
 */
import { tokenize } from '../lib/util.js';

export type MatchKind = 'disclosed' | 'partial' | 'not_found';

export const MATCH_WEIGHT: Record<MatchKind, number> = {
  disclosed: 1.0,
  partial:   0.5,
  not_found: 0.0,
};

export interface ElementScore {
  elementId: number;
  match: MatchKind;
}

export interface ClaimRefOverlap {
  referenceId: number;
  overlap: number; // 0..1 weighted
}

/** Weighted overlap of one claim against one reference. */
export function claimOverlapAgainstRef(
  elements: { id: number; weight: number }[],
  matches: { element_id: number; reference_id: number; match: MatchKind }[],
  referenceId: number,
): number {
  const byElement = new Map(matches.filter((m) => m.reference_id === referenceId).map((m) => [m.element_id, m.match]));
  let got = 0;
  let total = 0;
  for (const el of elements) {
    const w = Number(el.weight);
    total += w;
    const m = byElement.get(el.id);
    if (m) got += w * MATCH_WEIGHT[m];
  }
  return total === 0 ? 0 : got / total;
}

export function overlapAgainstAllRefs(
  elements: { id: number; weight: number }[],
  matches: { element_id: number; reference_id: number; match: MatchKind }[],
): ClaimRefOverlap[] {
  const refIds = [...new Set(matches.map((m) => m.reference_id))];
  return refIds
    .map((referenceId) => ({ referenceId, overlap: claimOverlapAgainstRef(elements, matches, referenceId) }))
    .sort((a, b) => b.overlap - a.overlap);
}

/**
 * Indian Patents Act 1970 risk levels:
 *  lack_of_novelty    — §2(1)(j): one reference discloses every element of the claim
 *  lack_of_inventive_step — §2(1)(ja): a combination of 2–3 references renders the claim obvious
 *  clear              — no prior-art overlap found at the threshold
 */
export type ClaimRisk = 'clear' | 'lack_of_inventive_step' | 'lack_of_novelty';

/**
 * §2(1)(j) lack of novelty if one reference fully discloses every element.
 * §2(1)(ja) lack of inventive step if 2–3 references combine to ≥ 0.9.
 */
export function claimRisk(perRef: ClaimRefOverlap[]): { risk: ClaimRisk; with: number[] } {
  const top = perRef[0];
  if (top && top.overlap >= 0.999) return { risk: 'lack_of_novelty', with: [top.referenceId] };
  const strong = perRef.filter((r) => r.overlap >= 0.3).slice(0, 3);
  if (strong.length >= 2) {
    const combined = strong.reduce((s, r) => s + r.overlap, 0);
    if (combined >= 0.9) return { risk: 'lack_of_inventive_step', with: strong.map((r) => r.referenceId) };
  }
  if (top && top.overlap >= 0.5) return { risk: 'lack_of_inventive_step', with: [top.referenceId] };
  return { risk: 'clear', with: [] };
}

export interface ClaimScoreInput {
  claimId: number;
  claimNo: number;
  type: 'independent' | 'dependent';
  elements: { id: number; weight: number }[];
}

export interface ScorecardMath {
  perClaim: {
    claimId: number;
    claimNo: number;
    type: string;
    overlapPct: number;
    risk: ClaimRisk;
    perRef: ClaimRefOverlap[];
  }[];
  maxIndependentRisk: number;
  avgDependentRisk: number;
  noveltyScore: number;
  verdict: 'clear' | 'lack_of_inventive_step' | 'lack_of_novelty' | 'partial_overlap';
}

const RISK_VALUE: Record<ClaimRisk, number> = {
  clear:                    0,
  lack_of_inventive_step:   0.6,
  lack_of_novelty:          1.0,
};

/** Full claim-level math → novelty score + verdict (ARCHITECTURE §8). */
export function computeScorecard(
  claims: ClaimScoreInput[],
  matches: { element_id: number; reference_id: number; match: MatchKind }[],
): ScorecardMath {
  const perClaim = claims.map((c) => {
    const perRef = overlapAgainstAllRefs(c.elements, matches);
    const { risk } = claimRisk(perRef);
    const best = perRef[0]?.overlap ?? 0;
    return { claimId: c.claimId, claimNo: c.claimNo, type: c.type, overlapPct: Math.round(best * 100), risk, perRef };
  });

  const independents = perClaim.filter((c) => c.type === 'independent');
  const dependents = perClaim.filter((c) => c.type === 'dependent');
  const maxInd = independents.length
    ? Math.max(...independents.map((c) => RISK_VALUE[c.risk]))
    : perClaim.length
      ? Math.max(...perClaim.map((c) => RISK_VALUE[c.risk]))
      : 0;
  const avgDep = dependents.length
    ? dependents.reduce((s, c) => s + RISK_VALUE[c.risk], 0) / dependents.length
    : maxInd;

  const risk = independents.length ? maxInd * 0.7 + avgDep * 0.3 : maxInd;
  const noveltyScore = Math.round(100 - 100 * risk);

  const worst = perClaim.reduce<ClaimRisk | null>((acc, c) => {
    if (acc === 'lack_of_novelty') return acc;
    if (c.risk === 'lack_of_novelty') return 'lack_of_novelty';
    if (c.risk === 'lack_of_inventive_step') return 'lack_of_inventive_step';
    return acc ?? c.risk;
  }, null);

  const verdict: ScorecardMath['verdict'] =
    worst === 'lack_of_novelty'
      ? 'lack_of_novelty'
      : worst === 'lack_of_inventive_step'
        ? 'lack_of_inventive_step'
        : perClaim.some((c) => c.overlapPct >= 25)
          ? 'partial_overlap'
          : 'clear';

  return { perClaim, maxIndependentRisk: maxInd, avgDependentRisk: avgDep, noveltyScore, verdict };
}

// ── Lexical fallback charting (offline / free mode, no LLM) ───────────

const DISCLOSED_T = 0.62;
const PARTIAL_T = 0.32;

export function lexicalMatchScore(elementText: string, refText: string): number {
  const el = tokenize(elementText);
  if (el.length === 0) return 0;
  const ref = new Set(tokenize(refText));
  let hit = 0;
  for (const t of el) if (ref.has(t)) hit++;
  return hit / el.length;
}

export function matchFromScore(score: number): MatchKind {
  if (score >= DISCLOSED_T) return 'disclosed';
  if (score >= PARTIAL_T) return 'partial';
  return 'not_found';
}

/** Best contiguous window of refText covering the element's tokens — verbatim by construction. */
export function bestQuoteWindow(elementText: string, refText: string, maxLen = 400): { quote: string; locator: string | null } | null {
  const elTokens = tokenize(elementText);
  if (!elTokens.length) return null;
  const sentences = refText.match(/[^.!?]+[.!?]+|\S[^.!?]*$/g) ?? [refText];
  let best: { score: number; text: string } | null = null;
  const elSet = new Set(elTokens);
  for (const raw of sentences) {
    const s = raw.trim();
    if (!s) continue;
    const toks = tokenize(s);
    if (!toks.length) continue;
    let hit = 0;
    for (const t of toks) if (elSet.has(t)) hit++;
    const cover = toks.filter((t) => elSet.has(t)).length / elTokens.length;
    const score = hit / toks.length + cover;
    if (!best || score > best.score) best = { score, text: s };
  }
  if (!best) return null;
  let quote = best.text;
  if (quote.length > maxLen) {
    const idx = quote.toLowerCase().indexOf((elTokens[0] ?? ''));
    const start = Math.max(0, idx - Math.floor(maxLen / 2));
    quote = quote.slice(start, start + maxLen).trim();
  }
  return { quote, locator: null };
}

/** Verbatim-integrity check (FEATURES F5): a chart quote must be a substring of the source. */
export function isVerbatim(quote: string | null | undefined, source: string): boolean {
  if (!quote) return false;
  const q = quote.trim();
  if (q.length < 8) return false;
  return source.includes(q);
}

// ── Billing (README §3 pricing) ───────────────────────────────────────

export interface PricingConfig {
  mode: 'runtime' | 'tier';
  rate: number;
  minFee: number;
  maxFee: number;
  tierName?: string;
  tierPrice?: number;
}

export function computePrice(billableSeconds: number, p: PricingConfig): number {
  if (p.mode === 'tier') return round2(p.tierPrice ?? p.minFee);
  const raw = p.rate * (billableSeconds / 60);
  return round2(Math.min(p.maxFee, Math.max(p.minFee, raw)));
}

const round2 = (n: number): number => Math.round(n * 100) / 100;
