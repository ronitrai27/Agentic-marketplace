/**
 * Client-side phrase catalog for Team Rail templates.
 * Templates are bound to structured payload — no free-form LLM prose in the rail.
 */

export interface RailLine {
  from: string;
  to: string;
  text: string;
}

export function railLine(templateId: string, payload: Record<string, unknown>): RailLine | null {
  const p = payload as Record<string, string | number | boolean | unknown[]>;
  const n = (k: string): number => Number(p[k] ?? 0);
  const s = (k: string): string => String(p[k] ?? '');

  switch (templateId) {
    case 'ari.intake.confirmed':
      return { from: 'Ari', to: 'Scout', text: 'Intake confirmed — draft parsed and queued for the pipeline.' };
    case 'ari.ingest.split':
      return {
        from: 'Ari',
        to: 'Scout',
        text: `Draft split into ${n('claims')} claim(s) (${n('independent')} independent), ${n('elements')} chartable elements.`,
      };
    case 'ari.ingest.provisional':
      return {
        from: 'Ari',
        to: 'Scout',
        text: `No formal claims found — drafted ${n('claims')} provisional claim(s) from the disclosure, ${n('elements')} elements.`,
      };
    case 'scout.query.plan':
      return {
        from: 'Scout',
        to: 'Clerk',
        text: `Query plan: ${Array.isArray(p['queries']) ? (p['queries'] as string[]).join(' · ') : s('phrase')}`,
      };
    case 'scout.report.sources': {
      const skipped = Array.isArray(p['sources'])
        ? (p['sources'] as { source: string; state: string; reason?: string }[])
            .filter((x) => x.state !== 'ok')
            .map((x) => `${x.source} (${x.state})`)
        : [];
      return {
        from: 'Scout',
        to: 'Ari',
        text: `Sources: ${n('ok')} live, ${n('skipped')} skipped, ${n('errored')} error(s) → ${n('total')} raw candidates.${
          skipped.length ? ` Not searched: ${skipped.join(', ')}.` : ''
        }`,
      };
    }
    case 'clerk.family.merge':
      return {
        from: 'Clerk',
        to: 'Examiner',
        text: `Merged to ${n('merged')} unique record(s) (${n('deduped')} duplicates folded), ${n('saved')} stored.`,
      };
    case 'examiner.search.results':
      return {
        from: 'Examiner',
        to: 'Cartographer',
        text: `${n('candidates')} candidate(s) ranked; ${n('crossReferenced')} selected for charting.`,
      };
    case 'cartographer.chart.start':
      return {
        from: 'Cartographer',
        to: 'Ari',
        text: `Charting ${n('claims')} claim(s) × ${n('references')} reference(s)…`,
      };
    case 'cartographer.cell':
      return {
        from: 'Cartographer',
        to: 'Examiner',
        text: `Claim ${n('claim_no')} elem ${n('element_no')} × ref #${n('reference_id')} → ${s('match')} (${n('overlap_pct')}%).`,
      };
    case 'cartographer.refinement':
      return { from: 'Cartographer', to: 'Scout', text: `Refinement: ${s('reason')}` };
    case 'examiner.chart.result':
      return {
        from: 'Examiner',
        to: 'Ari',
        text: `${n('cells')} cells decided: ${n('disclosed')} disclosed · ${n('partial')} partial · ${n('not_found')} not found (max ${n('max_overlap_pct')}%)${
          p['refined'] ? ' — after one widening pass' : ''
        }.`,
      };
    case 'examiner.redflags':
      return { from: 'Examiner', to: 'Ari', text: `${n('count')} red flag(s) raised from the chart.` };
    case 'ari.coverage': {
      const skipped = Array.isArray(p['skipped']) ? (p['skipped'] as string[]) : [];
      const warnings = Array.isArray(p['warnings']) ? (p['warnings'] as string[]) : [];
      let text = p['patent_sources_ok']
        ? 'Patent sources reached — coverage is real.'
        : '⚠ Patent sources unreachable — this run leaned on NPL/web only.';
      if (skipped.length) text += ` Skipped: ${skipped.join(', ')}.`;
      if (warnings.length) text += ` ${warnings.length} coverage warning(s).`;
      return { from: 'Ari', to: 'Ari', text };
    }
    case 'ari.score':
      return {
        from: 'Ari',
        to: 'You',
        text: `Novelty ${n('score')}/100 — verdict: ${s('verdict').replace('_', ' ')}.`,
      };
    case 'ari.failed':
      return { from: 'Ari', to: 'You', text: `Run failed: ${s('message')}` };
    default:
      return null;
  }
}

export function ariLine(templateId: string, payload: Record<string, unknown>): string {
  const p = payload as Record<string, unknown>;
  switch (templateId) {
    case 'ari.intake':
      return 'Draft received. I am briefing the team now — Scout is on search, Cartographer is standing by for the chart.';
    case 'ari.ingest':
      return `Parsing your disclosure (${Number(p['chars'] ?? 0).toLocaleString()} chars) into claims and elements…`;
    case 'ari.billing.approval':
      return `Billing guard armed: up to $${Number(p['max'] ?? 0).toFixed(2)} authorized, only metered time is captured at completion.`;
    case 'ari.billing.degraded':
      return `Payment provider hiccup (the run continues): ${String(p['message'] ?? '')}`;
    case 'ari.done':
      return `Scorecard ready — ${Number(p['seconds'])}s of task time metered at $${Number(p['price']).toFixed(2)}.`;
    default:
      return templateId;
  }
}
