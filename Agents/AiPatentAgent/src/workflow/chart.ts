/**
 * Stage 3 — Claim charting: every (claim element × selected reference) cell is decided.
 * LLM cells are quote-guarded (verbatim or dropped); offline mode uses deterministic
 * lexical overlap. One bounded refinement pass runs when the first pass finds nothing.
 */
import { config } from '../config.js';
import { mapLimit } from '../lib/util.js';
import {
  bestQuoteWindow,
  isVerbatim,
  lexicalMatchScore,
  matchFromScore,
} from '../scoring/overlap.js';
import { loadClaims, loadReferences, saveMatches } from '../store/db.js';
import { LlmChartCellSchema } from '../llm/chain.js';
import { T, trackedChat, type RunContext } from './types.js';
import { retrieveStep } from './retrieve.js';

export interface CellDecision {
  claimId: number;
  elementId: number;
  referenceId: number;
  claimNo: number;
  elementNo: number;
  match: 'disclosed' | 'partial' | 'not_found';
  quote: string | null;
  locator: string | null;
  commentary: string | null;
  overlapPct: number;
  via: 'llm' | 'lexical';
}

export interface ChartOutcome {
  cells: number;
  maxCellPct: number;
  refined: boolean;
}

export async function chartStep(ctx: RunContext): Promise<ChartOutcome> {
  await ctx.stage('charting', 'chart');

  const { claims, elements } = await loadClaims(ctx.analysis.id);

  if (!ctx.refs.length) {
    ctx.refs = (await loadReferences(ctx.analysis.id)).filter((r) => r.selected);
  }

  await ctx.say({
    from: 'cartographer',
    to: 'ari',
    template: T.chartStart,
    payload: { claims: claims.length, references: ctx.refs.length },
  });

  const chartedRefs = new Set<number>();
  const allCells: CellDecision[] = [];
  let refined = false;
  let pass = 0;

  for (;;) {
    pass++;
    const toChart = ctx.refs.filter((r) => !chartedRefs.has(r.id));
    if (!toChart.length) break;

    const perRef = await mapLimit(toChart, 4, async (ref) => {
      const cells: CellDecision[] = [];
      for (const claim of claims) {
        const claimEls = elements.filter((e) => e.claim_id === claim.id);
        const rows = await mapLimit(claimEls, 4, async (el) => {
          const cell = await decideCell(ctx, claim.id, claim.claim_no, el.id, el.element_no, el.text, ref);
          ctx.emit({
            type: 'cell_decided',
            claim_no: cell.claimNo,
            element_no: cell.elementNo,
            reference_id: cell.referenceId,
            match: cell.match,
            overlap_pct: cell.overlapPct,
          });
          return cell;
        });
        cells.push(...rows);
      }
      chartedRefs.add(ref.id);
      return cells;
    });

    const passCells = perRef.flat();
    allCells.push(...passCells);
    await persistCells(ctx, passCells);
    emitMatrix(ctx, allCells, claims.length, toChart.length);

    const maxPct = maxCell(allCells);

    // Bounded refinement (F3): one widening pass when nothing was found at all
    if (maxPct < 30 && !refined && pass === 1) {
      refined = true;
      ctx.refined = true;
      await ctx.say({
        from: 'cartographer',
        to: 'scout',
        template: T.refinement,
        payload: { reason: 'no cell ≥ 30% overlap — widening queries (1 of 1)' },
      });
      await retrieveStep(ctx, 'broad');
      continue;
    }
    break;
  }

  const maxCellPct = maxCell(allCells);
  await ctx.say({
    from: 'cartographer',
    to: 'examiner',
    template: T.chartResult,
    payload: {
      cells: allCells.length,
      refs: chartedRefs.size,
      disclosed: allCells.filter((c) => c.match === 'disclosed').length,
      partial: allCells.filter((c) => c.match === 'partial').length,
      not_found: allCells.filter((c) => c.match === 'not_found').length,
      max_overlap_pct: maxCellPct,
      refined,
    },
  });
  ctx.progress('claim chart complete', 3, 4);

  return { cells: allCells.length, maxCellPct, refined };
}

async function persistCells(ctx: RunContext, cells: CellDecision[]): Promise<void> {
  await saveMatches(
    ctx.analysis.id,
    cells.map((c) => ({
      claimId: c.claimId,
      elementId: c.elementId,
      referenceId: c.referenceId,
      match: c.match,
      quote: c.quote,
      locator: c.locator,
      commentary: c.commentary,
    })),
  );
}

function emitMatrix(ctx: RunContext, cells: CellDecision[], claimCount: number, refsThisPass: number): void {
  const matrix: Record<string, string> = {};
  for (const c of cells) matrix[`${c.claimNo}:${c.elementNo}:${c.referenceId}`] = c.match;
  ctx.emit({ type: 'partial_result', result: { chart: matrix, claimCount, refsThisPass } });
}

const maxCell = (cells: CellDecision[]): number =>
  cells.reduce((m, c) => Math.max(m, c.overlapPct), 0);

async function decideCell(
  ctx: RunContext,
  claimId: number,
  claimNo: number,
  elementId: number,
  elementNo: number,
  elementText: string,
  ref: { id: number; title: string | null; snippet: string | null; url: string; publication_number: string | null },
): Promise<CellDecision> {
  const cfg = config();
  const refText = [ref.title ?? '', ref.snippet ?? ''].filter(Boolean).join('\n\n').slice(0, cfg.MAX_FETCH_CHARS);
  const lexicalPct = Math.round(lexicalMatchScore(elementText, refText) * 100);
  const window = bestQuoteWindow(elementText, refText);

  let decision: {
    match: 'disclosed' | 'partial' | 'not_found';
    quote: string;
    locator: string;
    commentary: string;
  } | null = null;

  decision = await trackedChat(ctx, {
    system:
      'You build patent claim charts under Indian patent law (Indian Patents Act 1970). ' +
      'Given ONE claim element and ONE reference excerpt, decide whether the reference ' +
      'discloses the element. match: "disclosed" (every limitation present), "partial" (some present), ' +
      '"not_found" (absent). Jurisdiction: India — apply §2(1)(j) novelty standard. ' +
      'quote MUST be copied VERBATIM from the reference excerpt (substring, <=400 chars) supporting ' +
      'the decision; empty string if none. locator: paragraph/section hint. ' +
      'commentary: one short technical sentence.',
    user: `ELEMENT:\n${elementText}\n\nREFERENCE (${ref.publication_number ?? ref.url}):\n${refText}`,
    schema: LlmChartCellSchema,
    temperature: 0,
  });

  let via: 'llm' | 'lexical' = 'llm';
  if (decision) {
    ctx.chartMode = 'llm';
    // Verbatim integrity (F5): quote must exist in the source or it is discarded
    if (!isVerbatim(decision.quote, refText)) {
      decision.quote = window?.quote ?? '';
      decision.locator = window?.locator ?? '';
    }
    if (!decision.quote && decision.match === 'disclosed' && lexicalPct < 30) {
      // LLM says disclosed but there is no verifiable quote and lexical evidence is weak → downgrade
      decision.match = 'partial';
    }
  } else {
    via = 'lexical';
    const match = matchFromScore(lexicalPct / 100);
    decision = {
      match,
      quote: match === 'not_found' ? '' : (window?.quote ?? ''),
      locator: '',
      commentary:
        match === 'not_found'
          ? 'This document shares none of the wording used in this part of your claim.'
          : `Wording match only: ${lexicalPct}% of this part appears in this document.`,
    };
  }

  return {
    claimId,
    claimNo,
    elementId,
    elementNo,
    referenceId: ref.id,
    match: decision.match,
    quote: decision.quote ? decision.quote.slice(0, 500) : null,
    locator: decision.locator || null,
    commentary: decision.commentary || null,
    overlapPct: lexicalPct,
    via,
  };
}
