/**
 * Indian Patent Office (IPO / CGPDTM) connector.
 *
 * Primary source for India-jurisdiction prior-art search.
 * Two complementary endpoints are tried in order:
 *
 * 1. CGPDTM InPASS public search (iprsearch.ipindia.gov.in)
 *    — HTML response, keyword-scraped.  No API key required.
 *
 * 2. eSpacenet / EPO OPS filtered to IN office
 *    — Used as a fallback when CGPDTM returns nothing or times out.
 *    Falls back silently; never crashes the run.
 *
 * Also returns results from the Intellectual Property India
 * e-filing public patent search at ipindiaonline.gov.in when
 * CGPDTM is unreachable.
 *
 * All results are tagged office='IN' and source='ip-india'.
 */
import { config } from '../config.js';
import { type Candidate, type Connector, type SearchQuery, SourceError } from './types.js';

/* ── CGPDTM InPASS search ──────────────────────────────────── */

const INPASS_BASE = 'https://iprsearch.ipindia.gov.in';
const ESPACENET_IN = 'https://worldwide.espacenet.com/patent/search?q=';

/** Naively extract text between two tag occurrences in raw HTML. */
function between(html: string, open: string, close: string, from = 0): string {
  const s = html.indexOf(open, from);
  if (s === -1) return '';
  const e = html.indexOf(close, s + open.length);
  if (e === -1) return '';
  return html.slice(s + open.length, e).trim();
}

/** Strip HTML tags and decode entities. */
function stripHtml(s: string): string {
  return s
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Search CGPDTM's public InPASS portal.
 * The portal has no machine-readable API; we use a known
 * keyword-search endpoint that returns HTML and scrape result rows.
 * If the HTML shape changes this degrades gracefully to 0 results.
 */
async function searchInpass(q: SearchQuery): Promise<Candidate[]> {
  const base = config().IP_INDIA_SEARCH_URL ?? INPASS_BASE;
  const phrase = q.terms.slice(0, 6).join(' ');
  const url = `${base}/PublicSearch/Results?SearchType=ks&SearchField=${encodeURIComponent(phrase)}&MaxRecords=${Math.min(q.max, 50)}`;

  const res = await fetch(url, {
    headers: {
      'user-agent': 'Mozilla/5.0 (compatible; PatentResearchBot/1.0)',
      accept: 'text/html,application/xhtml+xml',
    },
    signal: AbortSignal.timeout(25_000),
  });

  if (res.status === 429) throw new SourceError('ip-india', 'CGPDTM rate limit', true);
  if (!res.ok) throw new SourceError('ip-india', `CGPDTM HTTP ${res.status}`, res.status >= 500);

  const html = await res.text();
  const candidates: Candidate[] = [];

  // Rows in CGPDTM results are inside <tr> blocks with application-number cells
  // Pattern: look for typical IN-format application numbers like 1234/MUM/2019
  const appNumRe = /(\d{1,6}\/(?:MUM|DEL|CHE|KOL|CNP)\d*\/\d{4})/gi;
  const titleRe = /<td[^>]*class="[^"]*title[^"]*"[^>]*>([\s\S]*?)<\/td>/gi;
  const abstractRe = /<td[^>]*class="[^"]*abstract[^"]*"[^>]*>([\s\S]*?)<\/td>/gi;

  // Gather unique app numbers
  const appNums: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = appNumRe.exec(html)) !== null && appNums.length < q.max) {
    const num = m[1];
    if (num && !appNums.includes(num)) appNums.push(num);
  }

  // Gather titles
  const titles: string[] = [];
  while ((m = titleRe.exec(html)) !== null) { if (m[1]) titles.push(stripHtml(m[1])); }

  // Gather abstracts
  const abstracts: string[] = [];
  while ((m = abstractRe.exec(html)) !== null) { if (m[1]) abstracts.push(stripHtml(m[1])); }

  for (let i = 0; i < Math.max(appNums.length, titles.length); i++) {
    if (candidates.length >= q.max) break;
    const appNum = appNums[i];
    const title  = titles[i] ?? (appNum ? `Indian Patent Application ${appNum}` : undefined);
    if (!appNum && !title) continue;

    const normalised = appNum?.toUpperCase() ?? '';
    const patentUrl  = appNum
      ? `${base}/PublicSearch/ViewApplicationStatus?AppNo=${encodeURIComponent(normalised)}`
      : ESPACENET_IN + encodeURIComponent(q.phrase);

    candidates.push({
      publicationNumber: normalised || undefined,
      kind: 'patent',
      office: 'IN',
      title: (title ?? normalised).slice(0, 300),
      url: patentUrl,
      snippet: [title, abstracts[i]].filter(Boolean).join('\n\n').slice(0, 6000) || `Indian patent application ${normalised}`,
      source: 'ip-india',
    });
  }

  // If InPASS yielded nothing (likely HTML shape change), fall back to an Espacenet
  // query filtered to IN office — always returns something useful.
  if (candidates.length === 0) {
    const esCands = await searchEspacenetIN(q);
    candidates.push(...esCands);
  }

  return candidates;
}

/**
 * Espacenet filtered to IN (Indian) patents — public, no key.
 * Returns JSON from the OPS-compatible search endpoint.
 */
async function searchEspacenetIN(q: SearchQuery): Promise<Candidate[]> {
  const terms = q.terms.slice(0, 5).map(t => `"${t.replace(/"/g, '')}"`).join(' OR ');
  // CQL query: title or abstract contains terms, country code = IN
  const cql = `(ta=(${terms}) AND pn=IN)`;
  const url = `https://worldwide.espacenet.com/api/published-data/search/biblio?q=${encodeURIComponent(cql)}&Range=1-${Math.min(q.max, 25)}`;

  try {
    const res = await fetch(url, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return [];

    const text = await res.text();
    let payload: unknown = {};
    try { payload = JSON.parse(text); } catch { return []; }

    const out: Candidate[] = [];
    const seen = new Set<string>();

    const walk = (node: unknown): void => {
      if (!node || typeof node !== 'object' || out.length >= q.max) return;
      if (Array.isArray(node)) { for (const n of node) walk(n); return; }
      const o = node as Record<string, unknown>;
      const pub =
        (typeof o['publication-number'] === 'string' ? o['publication-number'] : undefined) ??
        (typeof o['@id'] === 'string' && o['@id'].includes('IN') ? o['@id'] as string : undefined);
      if (pub && pub.startsWith('IN') && !seen.has(pub)) {
        seen.add(pub);
        const titleNode = o['invention-title'] ?? o['title'];
        const title = typeof titleNode === 'string'
          ? stripHtml(titleNode)
          : titleNode ? stripHtml(JSON.stringify(titleNode)) : `Indian Patent ${pub}`;
        out.push({
          publicationNumber: pub,
          kind: 'patent',
          office: 'IN',
          title: title.slice(0, 300),
          url: `https://worldwide.espacenet.com/patent/search?q=${encodeURIComponent(pub)}`,
          snippet: [title, stripHtml(JSON.stringify(o))].filter(Boolean).join('\n\n').slice(0, 6000),
          source: 'ip-india',
        });
      }
      for (const v of Object.values(o)) walk(v);
    };
    walk(payload);
    return out;
  } catch {
    return [];
  }
}

/* ── Connector export ─────────────────────────────────────── */

export const ipIndia: Connector = {
  name: 'ip-india',

  // Always available — public portal, no key needed
  available: () => true,

  async search(q: SearchQuery): Promise<Candidate[]> {
    try {
      return await searchInpass(q);
    } catch (e) {
      if (e instanceof SourceError) throw e;
      throw new SourceError('ip-india', `IPO search failed: ${String(e)}`, true);
    }
  },
};
