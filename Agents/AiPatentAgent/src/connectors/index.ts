/**
 * Connector fan-out — India jurisdiction only.
 * Three sources, all free:
 *  1. ip-india  — IPO / CGPDTM portal (Indian patents, always on, no key)
 *  2. arxiv     — non-patent literature / research papers (no key)
 *  3. epo-ops   — PCT/WO international filings designating India (free key)
 *
 * USPTO ODP, BigQuery, and TinyFish are intentionally removed —
 * they cover US/global datasets irrelevant to Indian jurisdiction.
 */
import { config } from '../config.js';
import { cosine } from '../embed/embed.js';
import { hashEmbed } from '../embed/embed.js';
import { arxiv } from './arxiv.js';
import { ipIndia } from './ipIndia.js';
import { type Candidate, type Connector, type SearchQuery, SourceError } from './types.js';

// Two sources — both need zero keys, zero signups, work instantly
export const ALL_CONNECTORS: Connector[] = [
  ipIndia,  // Indian Patent Office (IPO/CGPDTM) — no key, always on
  arxiv,    // arXiv research papers (non-patent literature) — no key, always on
];

export interface SourceStatus {
  source: string;
  state: 'ok' | 'skipped' | 'error';
  count: number;
  reason?: string;
}

export interface FanOutResult {
  candidates: Candidate[];
  statuses: SourceStatus[];
}

export function connectorStatuses(): SourceStatus[] {
  return ALL_CONNECTORS.map((c) => ({
    source: c.name,
    state: c.available() ? 'ok' : 'skipped',
    count: 0,
    reason: c.available() ? undefined : (c.unavailableReason?.() ?? 'not available'),
  }));
}

/** Fan out one query across all connectors; individual failures degrade the source only. */
export async function fanOut(q: SearchQuery): Promise<FanOutResult> {
  const statuses: SourceStatus[] = [];
  const available = ALL_CONNECTORS.filter((c) => c.available());

  const settled = await Promise.allSettled(
    available.map(async (c) => {
      try {
        const rows = await c.search(q);
        return { name: c.name, rows, error: null as SourceError | null };
      } catch (e) {
        const err = e instanceof SourceError ? e : new SourceError(c.name, String(e));
        return { name: c.name, rows: [] as Candidate[], error: err };
      }
    }),
  );

  const merged: Candidate[] = [];
  for (const s of settled) {
    if (s.status === 'rejected') continue;
    const { name, rows, error } = s.value;
    if (error) {
      statuses.push({ source: name, state: 'error', count: 0, reason: error.message });
    } else {
      statuses.push({ source: name, state: 'ok', count: rows.length });
      merged.push(...rows);
    }
  }
  for (const c of ALL_CONNECTORS.filter((c) => !c.available())) {
    statuses.push({
      source: c.name,
      state: 'skipped',
      count: 0,
      reason: c.unavailableReason?.() ?? 'not available',
    });
  }

  return { candidates: dedupe(merged), statuses };
}

export function dedupe(cands: Candidate[]): Candidate[] {
  const byKey = new Map<string, Candidate>();
  for (const c of cands) {
    const key = (c.publicationNumber ?? c.url ?? c.title ?? '').toLowerCase().replace(/\s+/g, '');
    if (!key) continue;
    const existing = byKey.get(key);
    if (!existing) byKey.set(key, c);
    else if ((c.snippet?.length ?? 0) > (existing.snippet?.length ?? 0)) byKey.set(key, c);
  }
  return [...byKey.values()];
}

export interface RankedCandidate extends Candidate {
  rank: number;
  breakdown: { keyword: number; embedding: number; recency: number };
}

/**
 * Rank blend (ARCHITECTURE §5): 0.55 keyword overlap + 0.30 embedding cosine
 * + 0.15 recency — computed entirely locally (hash embeddings, $0).
 */
export async function rankCandidates(
  cands: Candidate[],
  claimTexts: string[],
  opts: { max: number },
): Promise<RankedCandidate[]> {
  const queryVec = hashEmbed(claimTexts.join('\n').slice(0, 8000));
  const now = Date.now();

  const scored = cands.map((c) => {
    const kw = keywordScore(claimTexts, c);
    const emb = cosine(queryVec, hashEmbed(`${c.title ?? ''}\n${c.snippet}`.slice(0, 6000)));
    const rec = recencyScore(c.priorityDate ?? c.publicationDate, now);
    const rank = 0.55 * kw + 0.3 * clamp01(emb) + 0.15 * rec;
    return { ...c, rank: Number(rank.toFixed(3)), breakdown: { keyword: kw, embedding: Number(clamp01(emb).toFixed(3)), recency: rec } };
  });

  scored.sort((a, b) => b.rank - a.rank);
  return scored.slice(0, opts.max);
}

function keywordScore(claimTexts: string[], c: Candidate): number {
  const corpus = `${c.title ?? ''} ${c.snippet}`.toLowerCase();
  const terms = new Set(
    claimTexts
      .join(' ')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 4),
  );
  if (!terms.size) return 0;
  let hit = 0;
  for (const t of terms) if (corpus.includes(t)) hit++;
  return hit / terms.size;
}

function recencyScore(date: string | undefined, now: number): number {
  if (!date) return 0.5; // unknown → neutral
  const t = Date.parse(date);
  if (Number.isNaN(t)) return 0.5;
  const years = (now - t) / (365.25 * 24 * 3600);
  return Math.max(0, Math.min(1, 1 - years / 25)); // newer → higher (closer prior art)
}

const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));
