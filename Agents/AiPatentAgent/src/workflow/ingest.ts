/**
 * Stage 1 — Draft Interpreter (ARCHITECTURE §2 node 1).
 * LLM structured extraction of claims + element charting units; deterministic
 * heuristic fallback keeps the whole pipeline runnable offline (budget mode).
 */
import { LlmClaimSchema, type LlmClaims } from '../llm/chain.js';
import { config } from '../config.js';
import { sha256 } from '../lib/util.js';
import { embedTexts } from '../embed/embed.js';
import { saveClaims, upsertEmbeddings } from '../store/db.js';
import { T, trackedChat, type RunContext } from './types.js';

export interface ExtractedClaim {
  claimNo: number;
  type: 'independent' | 'dependent';
  provisional: boolean;
  text: string;
  elements: { elementNo: number; text: string; weight: number }[];
}

export async function ingestStep(ctx: RunContext): Promise<void> {
  const cfg = config();
  const draft = ctx.draftText;

  await ctx.ariLine('ari.ingest', { chars: draft.length, name: ctx.analysis.input_name });

  const system = `You are a patent claim-drafting specialist with expertise in Indian patent law.
Split the draft into claims under the Indian Patents Act 1970 (as amended):
- Every independent claim first (claim 1, 2...), then dependent claims (those referencing another).
- For each claim split the text into chartable elements — discrete technical limitations separated
  by "wherein", semicolons, or clauses (3–10 elements each).
- IMPORTANT: Flag any subject matter that may be excluded under Section 3 of the Indian Patents Act
  (e.g. §3(d) new forms of known substance, §3(k) computer programs per se, §3(f) methods of agriculture,
  §3(b) contrary to morality, §3(p) traditional knowledge) — tag such claims provisional=true with a
  note in the text.
- If the draft contains no formal patent-style claims, produce provisional claims: one per distinct
  technical embodiment or step group described, marked provisional=true, written as claim-like sentences
  suitable for Indian patent filing.
- Jurisdiction: India (IPO / CGPDTM). Apply §2(1)(j) novelty and §2(1)(ja) inventive step standards.`;

  const user = `DRAFT:\n${draft.slice(0, cfg.MAX_DRAFT_CHARS)}`;

  const llm = await trackedChat<LlmClaims>(ctx, { system, user, schema: LlmClaimSchema, temperature: 0.2 });

  let claims: ExtractedClaim[];
  let provisional = false;
  let approach = '';

  if (llm?.claims?.length) {
    claims = llm.claims.slice(0, cfg.MAX_CLAIMS).map((c, i) => ({
      claimNo: c.claimNo || i + 1,
      type: c.type,
      provisional: c.provisional,
      text: c.text.trim(),
      elements: c.elements.map((e, j) => ({
        elementNo: j + 1,
        text: e.text.trim(),
        weight: 1,
      })),
    }));
    approach = llm.approach;
  } else {
    const h = heuristicClaims(draft, cfg.MAX_CLAIMS);
    claims = h.claims;
    provisional = h.provisional;
  }

  if (!claims.length) {
    throw new Error('No claims could be extracted from the draft — is it empty or unreadable?');
  }

  const saved = await saveClaims(ctx.analysis.id, claims);
  const elementCount = saved.elements.length;

  // Embed claims → powers grounded follow-up questions (F25) without leaving the machine
  try {
    const vectors = await embedTexts(saved.claims.map((c) => c.text.slice(0, 4000)));
    await upsertEmbeddings(
      `analysis:${ctx.analysis.id}`,
      'claim',
      saved.claims.map((c, i) => ({
        refKey: `claim:${c.claim_no}`,
        content: c.text.slice(0, 4000),
        contentHash: sha256(`claim:${c.claim_no}:${c.text}`),
        vector: vectors[i] ?? vectors[0]!,
      })),
    );
  } catch {
    /* embeddings are an enhancement, never a run blocker */
  }

  await ctx.say({
    from: 'ari',
    to: 'scout',
    template: provisional ? T.ingestProvisional : T.ingestSplit,
    payload: {
      claims: claims.length,
      elements: elementCount,
      independent: claims.filter((c) => c.type === 'independent').length,
      provisional,
    },
  });

  ctx.emit({
    type: 'partial_result',
    result: {
      claims: saved.claims,
      elements: saved.elements,
      approach: approach || undefined,
    },
  });
  ctx.progress('claims extracted', 1, 4);
}

// ── Deterministic fallback (offline budget mode) ───────────────────────

export function heuristicClaims(text: string, maxClaims: number): { claims: ExtractedClaim[]; provisional: boolean } {
  const numbered = extractNumberedClaims(text);
  if (numbered.length) {
    return {
      claims: numbered.slice(0, maxClaims).map((c, i) => ({
        claimNo: i + 1,
        type: c.dependent ? 'dependent' : 'independent',
        provisional: false,
        text: c.text,
        elements: segmentElements(c.text),
      })),
      provisional: false,
    };
  }
  // No claim set → provisional claims from substantive paragraphs
  const paras = text
    .split(/\n\s*\n/)
    .map((p) => cleanClaimText(p))
    .filter((p) => p.length >= 80);
  const chosen = paras.slice(0, Math.min(3, maxClaims));
  if (!chosen.length && text.trim()) chosen.push(text.trim().slice(0, 1500));
  return {
    claims: chosen.map((p, i) => ({
      claimNo: i + 1,
      type: 'independent' as const,
      provisional: true,
      text: p,
      elements: segmentElements(p),
    })),
    provisional: true,
  };
}

function extractNumberedClaims(text: string): { text: string; dependent: boolean }[] {
  const lines = text.split(/\r?\n/);
  const out: { text: string; dependent: boolean }[] = [];
  let current: string[] | null = null;

  // Detection only. The old single regex ended in \S, so the replace() consumed the
  // claim's own first letter — "6. system presents" became "ystem presents".
  const isStart = /^\s*\d{1,2}\s*[.)]\s+\S/;
  const strip   = /^\s*\d{1,2}\s*[.)]\s+/;

  for (const line of lines) {
    if (isStart.test(line)) {
      if (current?.length) out.push(finish(current));
      current = [line.replace(strip, '')];
    } else if (current) {
      if (/^\s*\d{1,2}\s*[.)]\s*$/.test(line)) continue;
      current.push(line);
    }
  }
  if (current?.length) out.push(finish(current));
  return out.filter((c) => c.text.length >= 30);

  function finish(buf: string[]): { text: string; dependent: boolean } {
    const text2 = cleanClaimText(buf.join(' '));
    return {
      text: text2,
      dependent: /\b(of|claim|claims)\s+\d+\b/i.test(text2.slice(0, 200)),
    };
  }
}

const PAREN_MASK = '\u0001';

/**
 * Strip the markdown a pasted draft carries with it. Fenced code, heading markers, list
 * bullets and emphasis markers are authoring noise — they must never reach a chart cell
 * a human is trying to read ("``` is executed locally" / "### Embodiment 4").
 */
export function cleanClaimText(s: string): string {
  return s
    .replace(/```[\s\S]*?```/g, ' ')     // fenced code block, closed
    .replace(/`{2,}/g, ' ')              // stray/unclosed fence markers
    .replace(/`([^`]*)`/g, '$1')         // inline code
    .replace(/(^|\s)#{1,6}\s+/g, '$1')   // heading markers (lines are joined before this runs)
    .replace(/^\s*[-*+]\s+/gm, '')       // - bullet markers
    .replace(/\*\*?([^*]+)\*\*?/g, '$1') // **bold** / *italic*
    .replace(/\s+/g, ' ')
    .trim();
}

/** Hide commas that sit inside (…) so "crop (1=Wheat, 2=Rice, 3=Cotton)" stays one unit. */
function maskParenCommas(s: string): string {
  let depth = 0;
  let out = '';
  for (const ch of s) {
    if (ch === '(') { depth++; out += ch; continue; }
    if (ch === ')') { depth = Math.max(0, depth - 1); out += ch; continue; }
    out += (ch === ',' && depth > 0) ? PAREN_MASK : ch;
  }
  return out;
}

const unmaskParenCommas = (s: string): string => s.split(PAREN_MASK).join(',');

/** Segment a claim into chartable elements: semicolons → wherein-clauses → comma groups. */
export function segmentElements(claimText: string): { elementNo: number; text: string; weight: number }[] {
  const text = cleanClaimText(claimText);
  let parts = text.split(/;\s*/).map((s) => s.trim()).filter((s) => s.length > 5);

  if (parts.length < 2) {
    parts = maskParenCommas(text)
      .split(/,\s*(?=wherein\b|configured to\b|operable to\b|adapted to\b|for\b)/i)
      .map((s) => s.trim()).filter((s) => s.length > 5)
      .map(unmaskParenCommas);
  }
  if (parts.length < 2) {
    const comma = maskParenCommas(text).split(/,\s*/).map((s) => s.trim()).filter((s) => s.length > 5);
    if (comma.length >= 3) {
      // group commas into chunks of ~2 to keep elements meaningful
      parts = [];
      for (let i = 0; i < comma.length; i += 2) parts.push(comma.slice(i, i + 2).join(', '));
      parts = parts.map(unmaskParenCommas);
    } else {
      parts = text.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter((s) => s.length > 10);
    }
  }
  if (!parts.length) parts = [text.trim()];

  const capped = parts.slice(0, 12);
  return capped.map((t, i) => ({ elementNo: i + 1, text: t, weight: 1 }));
}
