/**
 * arXiv connector — free, keyless, CC0 abstracts (Atom feed).
 * Politeness: 3 s between calls (arXiv API terms), sequential pacing across queries.
 */
import { config } from '../config.js';
import { delay } from '../lib/util.js';
import { type Candidate, type Connector, type SearchQuery, SourceError } from './types.js';

const ARXIV_BASE = 'https://export.arxiv.org/api/query';
let lastCall = 0;

function decodeXml(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function field(entry: string, tag: string): string {
  const m = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`).exec(entry);
  return m?.[1] ? decodeXml(m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')) : '';
}

export const arxiv: Connector = {
  name: 'arxiv',

  available: () => config().ARXIV_ENABLED,

  unavailableReason: () => 'arXiv disabled (ARXIV_ENABLED=false)',

  async search(q: SearchQuery): Promise<Candidate[]> {
    if (!this.available()) return [];
    const wait = 3000 - (Date.now() - lastCall);
    if (wait > 0) await delay(wait);
    lastCall = Date.now();

    // Boolean AND of terms — exact-phrase `all:"a b c"` has near-zero recall for
    // multi-term invention queries (verified live); our local ranker handles precision.
    const searchQuery = q.terms.length
      ? q.terms.slice(0, 5).map((t) => `all:${t.replace(/[^a-z0-9]/gi, '')}`).join(' AND ')
      : `all:${q.phrase.replace(/[^a-z0-9\s]/gi, '').trim().split(/\s+/).slice(0, 5).join(' AND ')}`;
    const url = `${ARXIV_BASE}?search_query=${encodeURIComponent(searchQuery)}&start=0&max_results=${q.max}&sortBy=relevance`;

    const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    if (res.status === 429) throw new SourceError('arxiv', 'arXiv rate limit (429)', true);
    if (!res.ok) throw new SourceError('arxiv', `arXiv HTTP ${res.status}`, res.status >= 500);

    const xml = await res.text();
    const entries = xml.match(/<entry>[\s\S]*?<\/entry>/g) ?? [];
    const out: Candidate[] = [];
    for (const e of entries) {
      const id = field(e, 'id'); // e.g. http://arxiv.org/abs/2401.12345v1
      const absId = id.replace(/^https?:\/\/arxiv\.org\/abs\//, '').replace(/v\d+$/, '');
      const title = field(e, 'title');
      const summary = field(e, 'summary');
      if (!absId && !title) continue;
      out.push({
        publicationNumber: absId || undefined,
        kind: 'npl',
        office: 'arXiv',
        title: title.slice(0, 300),
        publicationDate: field(e, 'published').slice(0, 10) || undefined,
        url: id || `https://arxiv.org/abs/${absId}`,
        snippet: [title, summary].filter(Boolean).join('\n\n').slice(0, 6000),
        source: 'arxiv',
      });
      if (out.length >= q.max) break;
    }
    return out;
  },
};
