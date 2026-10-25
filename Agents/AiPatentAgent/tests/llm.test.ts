import { describe, expect, it } from 'vitest';
import { LlmChartCellSchema, LlmClaimSchema, LlmQueriesSchema, LlmVerdictSchema, recoverJson } from '../src/llm/chain.js';

describe('recoverJson (LLM reply → parseable object)', () => {
  it('unwraps code-fenced JSON', () => {
    expect(recoverJson('```json\n{"a":1}\n```')).toBe('{"a":1}');
  });

  it('extracts the object from prose preambles', () => {
    expect(recoverJson('Sure! Here is the result: {"a": 1} — let me know.')).toBe('{"a": 1}');
  });

  it('throws when there is no object', () => {
    expect(() => recoverJson('no json here')).toThrow();
  });
});

describe('pipeline schemas accept well-formed replies', () => {
  it('parses claim extraction output', () => {
    const r = LlmClaimSchema.safeParse({
      claims: [
        {
          claimNo: 1,
          type: 'independent',
          provisional: false,
          text: 'A method comprising receiving input and producing a result.',
          elements: [{ text: 'receiving input' }, { text: 'producing a result' }],
        },
      ],
      approach: 'x',
    });
    expect(r.success).toBe(true);
  });

  it('rejects a chart cell with an invalid match', () => {
    const r = LlmChartCellSchema.safeParse({ match: 'maybe', quote: '', locator: '', commentary: '' });
    expect(r.success).toBe(false);
  });

  it('parses verdict output with defaults', () => {
    const r = LlmVerdictSchema.safeParse({ redFlags: [], rewriteSuggestions: [] });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.closestReferenceNote).toBe('');
  });

  it('parses query formulation output', () => {
    const r = LlmQueriesSchema.safeParse({ queries: ['neural engine kv cache'], cpcGuess: 'G06N' });
    expect(r.success).toBe(true);
  });
});
