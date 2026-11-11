import { AGENT_TAGS } from "@/lib/agent-tags";
import { editDistance, normalize, tokensOf } from "@/lib/search-text";

/**
 * Instant search runs in the browser over the whole catalog (a slim, live list from Convex), so every keystroke
 * answers in a millisecond with no network. The server only adds the "by meaning" results afterwards.
 */

/** One agent as the search bar needs it (see chefAgents.listForSearch). */
export type CatalogAgent = {
  id: string;
  slug: string;
  name: string;
  logoUrl?: string;
  tags: string[];
  models: string[];
  ratingAvg: number;
  ratingCount: number;
  /** Start of the description: searched, never shown. */
  blurb: string;
};

/** What /api/search returns: agent ids in meaning order, to be looked up in the catalog. */
export type SemanticResponse = { exact: string[]; related: string[]; similar: string[] };

export type NamePart = { text: string; mark: boolean };

/** The name split into plain and highlighted parts (the typed words are highlighted). */
export function highlightParts(name: string, q: string): NamePart[] {
  const words = tokensOf(q);
  if (words.length === 0) return [{ text: name, mark: false }];
  const re = new RegExp(`(${words.join("|")})`, "gi"); // tokens are letters and digits only
  return name
    .split(re)
    .map((text, i) => ({ text, mark: i % 2 === 1 }))
    .filter((p) => p.text.length > 0);
}

// words each tag answers to, computed once
const TAG_WORDS = new Map<string, string[]>(
  AGENT_TAGS.map((t) => [t.id, [t.label, ...t.keywords].flatMap((s) => normalize(s).split(" ")).filter(Boolean)]),
);

const startsWithWord = (words: string[], t: string) => words.some((w) => w.startsWith(t));

/**
 * Ranks the catalog for a typed query: name (exact, prefix, word prefix, contains), then tags and their keywords,
 * then the description, with small typos forgiven. Returns best first.
 */
export function localSearch(list: CatalogAgent[], q: string, limit = 6): CatalogAgent[] {
  const full = normalize(q);
  if (full.length < 1) return [];
  const tokens = tokensOf(q);
  const scored: { a: CatalogAgent; score: number }[] = [];

  for (const a of list) {
    const name = normalize(a.name);
    const nameWords = name.split(" ");
    let score = 0;

    if (name === full) score += 100;
    else if (name.startsWith(full)) score += 90;
    else if (startsWithWord(nameWords, full)) score += 80;
    else if (full.length >= 2 && name.includes(full)) score += 65;

    const tagWords = a.tags.flatMap((id) => TAG_WORDS.get(id) ?? []);
    const blurbWords = normalize(a.blurb).split(" ");

    let matched = 0;
    for (const t of tokens) {
      let s = 0;
      if (startsWithWord(nameWords, t)) s = 24;
      else if (name.includes(t)) s = 14;
      else if (tagWords.includes(t)) s = 14;
      else if (startsWithWord(tagWords, t)) s = 10;
      else if (startsWithWord(blurbWords, t)) s = 5;
      else if (t.length >= 4) {
        const max = t.length >= 8 ? 2 : 1;
        // a typo: "reserch", "resarch"
        if ([...nameWords, ...tagWords].some((w) => w.length >= 4 && editDistance(t, w, max) <= max)) s = 8;
      }
      if (s) matched++;
      score += s;
    }
    // every meaningful word of a longer query helps; unmatched ones count against it
    if (tokens.length > 1) score += matched === tokens.length ? 12 : -4 * (tokens.length - matched);

    if (score > 0) scored.push({ a, score: score + a.ratingAvg * 0.4 });
  }
  return scored.sort((x, y) => y.score - x.score).slice(0, limit).map((s) => s.a);
}
