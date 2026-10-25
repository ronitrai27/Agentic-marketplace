import { describe, expect, it } from 'vitest';
import {
  bestQuoteWindow,
  claimOverlapAgainstRef,
  claimRisk,
  computePrice,
  computeScorecard,
  isVerbatim,
  lexicalMatchScore,
  matchFromScore,
  overlapAgainstAllRefs,
} from '../src/scoring/overlap.js';

const els = [
  { id: 1, weight: 1 },
  { id: 2, weight: 1 },
  { id: 3, weight: 1 },
];

const m = (element_id: number, reference_id: number, match: 'disclosed' | 'partial' | 'not_found') => ({
  element_id,
  reference_id,
  match,
});

describe('claimOverlapAgainstRef', () => {
  it('is 1.0 when every element is disclosed (§2(1)(j) shape)', () => {
    const matches = [m(1, 10, 'disclosed'), m(2, 10, 'disclosed'), m(3, 10, 'disclosed')];
    expect(claimOverlapAgainstRef(els, matches, 10)).toBe(1);
  });

  it('weights partial at 0.5 and missing at 0', () => {
    const matches = [m(1, 10, 'disclosed'), m(2, 10, 'partial'), m(3, 10, 'not_found')];
    expect(claimOverlapAgainstRef(els, matches, 10)).toBeCloseTo((1 + 0.5) / 3, 6);
  });

  it('returns 0 for references without any cells', () => {
    expect(claimOverlapAgainstRef(els, [], 10)).toBe(0);
  });

  it('honours element weights', () => {
    const weighted = [
      { id: 1, weight: 2 },
      { id: 2, weight: 1 },
    ];
    const matches = [m(1, 10, 'disclosed'), m(2, 10, 'not_found')];
    expect(claimOverlapAgainstRef(weighted, matches, 10)).toBeCloseTo(2 / 3, 6);
  });
});

describe('claimRisk (ARCHITECTURE §8)', () => {
  it('flags lack_of_novelty on a single 100% reference', () => {
    expect(claimRisk([{ referenceId: 1, overlap: 1 }])).toEqual({ risk: 'lack_of_novelty', with: [1] });
  });

  it('flags lack_of_inventive_step when two strong references combine ≥ 0.9', () => {
    const r = claimRisk([
      { referenceId: 1, overlap: 0.5 },
      { referenceId: 2, overlap: 0.5 },
    ]);
    expect(r.risk).toBe('lack_of_inventive_step');
    expect(r.with).toEqual([1, 2]);
  });

  it('does not combine weak references (< 0.3 each)', () => {
    const r = claimRisk([
      { referenceId: 1, overlap: 0.25 },
      { referenceId: 2, overlap: 0.25 },
      { referenceId: 3, overlap: 0.25 },
    ]);
    expect(r.risk).toBe('clear');
  });

  it('is clear below the partial threshold', () => {
    expect(claimRisk([{ referenceId: 1, overlap: 0.2 }]).risk).toBe('clear');
  });
});

describe('computeScorecard', () => {
  const claims = [
    { claimId: 1, claimNo: 1, type: 'independent' as const, elements: els },
    { claimId: 2, claimNo: 2, type: 'dependent' as const, elements: els },
  ];

  it('scores 100 / clear with no matches', () => {
    const s = computeScorecard(claims, []);
    expect(s.noveltyScore).toBe(100);
    expect(s.verdict).toBe('clear');
  });

  it('scores 0 / lack_of_novelty when one reference charts everything', () => {
    const matches = [m(1, 10, 'disclosed'), m(2, 10, 'disclosed'), m(3, 10, 'disclosed')];
    const s = computeScorecard(claims, matches);
    expect(s.verdict).toBe('lack_of_novelty');
    expect(s.noveltyScore).toBe(0);
  });

  it('orders per-ref overlaps descending', () => {
    const matches = [m(1, 10, 'partial'), m(2, 10, 'partial'), m(3, 10, 'partial'), m(1, 20, 'not_found')];
    const perRef = overlapAgainstAllRefs(els, matches);
    expect(perRef[0]?.referenceId).toBe(10);
    expect(perRef[0]?.overlap).toBeCloseTo(0.5, 6);
  });

  it('stays within 0..100 always', () => {
    const s = computeScorecard(claims, [m(1, 10, 'disclosed')]);
    expect(s.noveltyScore).toBeGreaterThanOrEqual(0);
    expect(s.noveltyScore).toBeLessThanOrEqual(100);
  });
});

describe('lexical fallback charting', () => {
  it('scores overlap from shared content words', () => {
    const score = lexicalMatchScore(
      'streaming key value cache blocks from unified memory',
      'the unified memory stores key value cache blocks which are streamed to the accelerator',
    );
    expect(score).toBeGreaterThan(0.62);
    expect(matchFromScore(score)).toBe('disclosed');
  });

  it('scores unrelated text as not_found', () => {
    expect(matchFromScore(lexicalMatchScore('quantum error correction codes', 'a recipe for baking bread with flour'))).toBe(
      'not_found',
    );
  });
});

describe('verbatim quote integrity (F5)', () => {
  const source =
    'In a preferred embodiment the controller partitions attention heads across the neural engine cores. The KV-cache is streamed from unified memory.';

  it('extracts a quote that is a substring of the source', () => {
    const w = bestQuoteWindow('controller partitions attention heads across neural engine cores', source);
    expect(w).not.toBeNull();
    expect(source.includes(w!.quote)).toBe(true);
  });

  it('isVerbatim rejects forged or truncated quotes', () => {
    expect(isVerbatim('partitions attention heads across the neural engine', source)).toBe(true);
    expect(isVerbatim('partitions attention heads across mars', source)).toBe(false);
    expect(isVerbatim('short', source)).toBe(false);
    expect(isVerbatim(null, source)).toBe(false);
  });
});

describe('pricing: task-hour metering', () => {
  const cfg = { mode: 'runtime' as const, rate: 0.04, minFee: 0.1, maxFee: 1.5 };

  it('applies the minimum fee for short runs', () => {
    expect(computePrice(30, cfg)).toBe(0.1);
    expect(computePrice(60, cfg)).toBe(0.1); // 1 min × $0.04 = $0.04 → floor
  });

  it('meters linearly in the band', () => {
    expect(computePrice(600, cfg)).toBe(0.4); // 10 min × $0.04
  });

  it('caps at the PayPal authorization ceiling', () => {
    expect(computePrice(7200, cfg)).toBe(1.5); // 2 h would be $4.80 → cap
  });

  it('tier mode returns the tier price', () => {
    expect(computePrice(60, { ...cfg, mode: 'tier', tierName: 'Standard', tierPrice: 0.25 })).toBe(0.25);
  });
});
