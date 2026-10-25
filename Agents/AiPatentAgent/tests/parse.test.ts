import { describe, expect, it } from 'vitest';
import { DraftTooLargeError, UnreadableFileError, normalizeForHash, parseUpload } from '../src/parse/documents.js';
import { heuristicClaims, segmentElements } from '../src/workflow/ingest.js';

const opts = { maxChars: 20000, maxBytes: 5 * 1024 * 1024 };

describe('parseUpload', () => {
  it('parses pasted text and hashes deterministically', async () => {
    const a = await parseUpload({ text: 'A method for inference comprising receiving a model.' }, opts);
    const b = await parseUpload({ text: 'a   method for inference comprising   receiving a model.' }, opts);
    expect(a.hash).toBe(b.hash); // whitespace-insensitive dedupe
    expect(a.kind).toBe('text');
    expect(a.chars).toBeGreaterThan(10);
  });

  it('detects markdown and latex', async () => {
    const md = await parseUpload({ text: '# Title\n\nSome **bold** claim text here.' }, opts);
    expect(md.kind).toBe('md');
    const tex = await parseUpload({ text: '\\documentclass{article}\n\\begin{document}\nHi\n\\end{document}' }, opts);
    expect(tex.kind).toBe('latex');
  });

  it('parses a .txt buffer upload', async () => {
    const r = await parseUpload(
      { buffer: Buffer.from('1. A system comprising: a processor; and a memory.', 'utf8'), name: 'draft.txt' },
      opts,
    );
    expect(r.kind).toBe('text');
    expect(r.text).toContain('processor');
  });

  it('rejects oversized drafts', async () => {
    await expect(parseUpload({ text: 'x'.repeat(500) }, { ...opts, maxChars: 100 })).rejects.toThrow(DraftTooLargeError);
  });

  it('rejects empty input', async () => {
    await expect(parseUpload({ text: '   ' }, opts)).rejects.toThrow(UnreadableFileError);
    await expect(parseUpload({}, opts)).rejects.toThrow(UnreadableFileError);
  });

  it('rejects files over the byte limit', async () => {
    await expect(
      parseUpload({ buffer: Buffer.alloc(2048), name: 'big.txt' }, { ...opts, maxBytes: 1024 }),
    ).rejects.toThrow(UnreadableFileError);
  });

  it('normalizeForHash collapses case and whitespace', () => {
    expect(normalizeForHash('  Hello   WORLD\n')).toBe('hello world');
  });
});

describe('heuristic claim extraction (offline fallback)', () => {
  const numbered = `
    1. A method for on-device inference, the method comprising:
       receiving a quantized transformer model; partitioning attention heads across neural engine cores; and
       streaming KV-cache blocks from unified memory.

    2. The method of claim 1, wherein the quantization is 4-bit.
  `;

  it('finds numbered claims and marks the dependent one', () => {
    const { claims, provisional } = heuristicClaims(numbered, 20);
    expect(provisional).toBe(false);
    expect(claims.length).toBe(2);
    expect(claims[0]?.type).toBe('independent');
    expect(claims[1]?.type).toBe('dependent');
    expect(claims[1]?.text).toContain('4-bit');
  });

  it('keeps the claim\'s own first character (regression: the old regex ate it)', () => {
    const { claims } = heuristicClaims(
      `
      6. System presents a menu to the user.
      7. Farmer selects a symptom category from a second menu.
      8. The backend matches crop and symptom to the prediction.
      `,
      20,
    );
    expect(claims.map((c) => c.text.slice(0, 6))).toEqual(['System', 'Farmer', 'The ba']);
  });

  it('strips markdown a pasted draft carries with it', () => {
    const { claims } = heuristicClaims(
      `
      1. A system comprising:\n\`\`\`\nis executed locally in under 50 ms.\n\`\`\`
      ### Embodiment 4 — USSD Gateway
      The gateway sends an SMS reply within 90 seconds to the handset.
      2. **Wherein** the reply is *plain text* only.
      `,
      20,
    );
    expect(claims[0]?.text).not.toContain('```');
    expect(claims[0]?.text).not.toContain('###');
    expect(claims[0]?.text).toContain('Embodiment 4');
    expect(claims[1]?.text).toBe('Wherein the reply is plain text only.');
  });

  it('does not split a comma list inside parentheses', () => {
    const els = segmentElements(
      'A system presents a menu: Select crop (1=Wheat, 2=Rice, 3=Cotton), then a symptom menu.',
    );
    expect(els[0]?.text).toContain('(1=Wheat, 2=Rice, 3=Cotton)');
    expect(els.some((e) => /^\d=/.test(e.text))).toBe(false);
  });

  it('segments elements on semicolons', () => {
    const els = segmentElements(
      'A method comprising: receiving a model; partitioning attention heads; and streaming cache blocks from memory',
    );
    expect(els.length).toBeGreaterThanOrEqual(3);
    expect(els[0]?.elementNo).toBe(1);
    expect(els.every((e) => e.weight === 1)).toBe(true);
  });

  it('segments wherein-clauses when there are no semicolons', () => {
    const els = segmentElements('A system comprising a parser, wherein the parser is incremental, and a cache');
    expect(els.length).toBeGreaterThanOrEqual(2);
  });

  it('falls back to provisional claims when the draft has no claim set', () => {
    const prose = `
      This document describes a new approach to federated learning. The server aggregates gradients from
      edge devices using a secure aggregation protocol with differential privacy noise added per device.

      The system further compresses updates with sparse ternary encoding before transmission, cutting
      bandwidth by an order of magnitude while preserving convergence on non-IID device data distributions.
    `;
    const { claims, provisional } = heuristicClaims(prose, 20);
    expect(provisional).toBe(true);
    expect(claims.length).toBeGreaterThanOrEqual(1);
    expect(claims[0]?.elements.length).toBeGreaterThanOrEqual(1);
  });
});
