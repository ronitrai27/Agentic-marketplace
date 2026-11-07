import { AGENT_TAGS } from "@/lib/agent-tags";
import { normalize, tokensOf } from "@/lib/search-text";
import { ensureSearchSchema, searchPool } from "./db";
import { embedQuery, toVector } from "./embed";

export type Ranked = { id: string; score: number };
export type RankedGroups = {
  /** The name matches (equal, starts with, contains, or a close typo). */
  exact: Ranked[];
  /** Everything else that fits, fused from keywords, meaning and tags. */
  related: Ranked[];
  /** Nearest neighbours of the best result. */
  similar: Ranked[];
};

/** Tags whose label or keywords share a word with the query ("website audit" -> Technical SEO, Audit...). */
function tagsFor(tokens: string[]): string[] {
  const hits = new Map<string, number>();
  for (const tag of AGENT_TAGS) {
    const words = new Set([tag.label, ...tag.keywords].flatMap((s) => normalize(s).split(" ")));
    const n = tokens.filter((t) => words.has(t)).length;
    if (n > 0) hits.set(tag.id, n);
  }
  return [...hits.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([id]) => id);
}

/** Reciprocal-rank fusion: an agent ranked well by several signals beats one ranked first by a single signal. */
const K = 60;
const W = { name: 1.6, text: 1, meaning: 1.3, tag: 0.8 };
/** Cosine distance past which a "nearest" agent is not really related (text-embedding-3-small: related ~0.4-0.65, unrelated 0.8+). */
const MAX_DIST = 0.72;
const MAX_SIMILAR_DIST = 0.6;
/** Close enough in meaning to count on its own. */
const STRONG_DIST = 0.65;

/** Light name weight for task searches: a name is a weak hint about what an agent does ("Rox Agent", "Nova Team"). */
const LIGHT_NAME = 0.35;

type Opts = {
  exact?: number;
  related?: number;
  similar?: number;
  /** "strong" (default): the user is looking for a name. "light": the user described a task, so what the agent
   *  does (description, capabilities, tags, meaning) decides and the name only breaks ties. */
  names?: "strong" | "light";
};

// Answers kept for a minute: the same search again (retyping, a second user, the chef after the bar) is instant.
const CACHE_MS = 60_000;
const CACHE_MAX = 200;
const cache = new Map<string, { at: number; v: RankedGroups }>();
/** Call after the index changed, so no one is served the old answer. */
export const clearSearchCache = () => cache.clear();

export async function searchRanked(q: string, opts: Opts = {}): Promise<RankedGroups> {
  const key = `${normalize(q)}|${opts.exact ?? 4}|${opts.related ?? 4}|${opts.similar ?? 3}|${opts.names ?? "strong"}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.v;
  const v = await rank(q, opts);
  cache.set(key, { at: Date.now(), v });
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value as string);
  return v;
}

async function rank(q: string, opts: Opts): Promise<RankedGroups> {
  const nExact = opts.exact ?? 4;
  const nRelated = opts.related ?? 4;
  const nSimilar = opts.similar ?? 3;
  const light = opts.names === "light";

  await ensureSearchSchema();
  const db = searchPool();
  // Name matching ignores filler words, or "zzzqq agent" would "match" every agent called "... Agent"
  const tokens0 = tokensOf(q);
  const norm = tokens0.length ? tokens0.join(" ") : normalize(q);
  const tokens = tokensOf(q);
  const tsq = tokens.map((t) => `${t}:*`).join(" | "); // tokens are letters and digits only, so this is safe
  const tagIds = tagsFor(tokens);

  // The meaning search is embed -> one statement (nearest agents, plus the neighbours of the closest one), and it
  // runs alongside the name, word and tag queries instead of after them. Each statement is one trip to Postgres.
  type MeaningRow = { k: "m" | "s"; agent_id: string; d: number };
  const meaningP: Promise<MeaningRow[] | null> = embedQuery(norm).then(async (vec) => {
    if (!vec) return null;
    const res = await db.query(
      `with m as (
         select agent_id, embedding <=> $1::vector as d from agent_search
          where embedding is not null order by d limit 20),
       seed as (
         select a.embedding from agent_search a join m on m.agent_id = a.agent_id order by m.d limit 1),
       s as (
         select b.agent_id, b.embedding <=> (select embedding from seed) as d from agent_search b
          where b.embedding is not null order by d limit 9)
       select 'm' as k, agent_id, d from m union all select 's', agent_id, d from s`,
      [toVector(vec)],
    );
    return res.rows as MeaningRow[];
  });
  const [meaningRows, name, text, tag] = await Promise.all([
    meaningP,
    db.query(
      `select agent_id, (name_norm = $1) as eq, (name_norm like $1 || '%') as pre, (name_norm like '%' || $1 || '%') as con,
              greatest(similarity(name_norm, $1), word_similarity($1, name_norm)) as sim
         from agent_search
        where name_norm like '%' || $1 || '%'
           or greatest(similarity(name_norm, $1), word_similarity($1, name_norm)) > 0.4
        order by eq desc, pre desc, con desc, sim desc limit 12`,
      [norm],
    ),
    tsq
      ? db.query(
          `select agent_id, ts_rank_cd(fts, to_tsquery('english', $1)) as r
             from agent_search where fts @@ to_tsquery('english', $1) order by r desc limit 20`,
          [tsq],
        )
      : Promise.resolve({ rows: [] as { agent_id: string }[] }),
    tagIds.length
      ? db.query(
          `select agent_id, cardinality(array(select unnest(tags) intersect select unnest($1::text[]))) as n
             from agent_search where tags && $1::text[] order by n desc limit 20`,
          [tagIds],
        )
      : Promise.resolve({ rows: [] as { agent_id: string }[] }),
  ]);
  const meaning = { rows: (meaningRows ?? []).filter((r) => r.k === "m") };

  const score = new Map<string, number>();
  const signals = new Map<string, Set<string>>(); // which kinds of evidence back each agent
  const add = (kind: string, rows: { agent_id: string }[], w: number) =>
    rows.forEach((r, i) => {
      score.set(r.agent_id, (score.get(r.agent_id) ?? 0) + w / (K + i + 1));
      signals.set(r.agent_id, (signals.get(r.agent_id) ?? new Set()).add(kind));
    });
  add("name", name.rows, light ? LIGHT_NAME : W.name);
  add("text", text.rows, W.text);
  add("tag", tag.rows, W.tag);
  add("meaning", meaning.rows.filter((r: { d: number }) => r.d <= MAX_DIST), W.meaning);
  // A weak single hint (one stray tag keyword, one loose word) is not a match: "audit my website" must not
  // return a jobs agent. An agent is related when its meaning is close, or two kinds of evidence agree.
  const strongMeaning = new Set(meaning.rows.filter((r: { d: number }) => r.d <= STRONG_DIST).map((r: { agent_id: string }) => r.agent_id));
  // In a task search a name match is not evidence of what the agent does, so it does not count as a second kind.
  const evidence = (id: string) => [...(signals.get(id) ?? [])].filter((k) => !(light && k === "name")).length;
  const relevant = (id: string) => strongMeaning.has(id) || evidence(id) >= 2;

  const exactRows = (name.rows as { agent_id: string; eq: boolean; pre: boolean; con: boolean; sim: number }[]).filter(
    (r) => r.eq || r.pre || (!light && (r.con || r.sim >= 0.55)),
  );
  const exact: Ranked[] = exactRows.slice(0, nExact).map((r) => ({ id: r.agent_id, score: score.get(r.agent_id) ?? 0 }));
  const seen = new Set(exact.map((e) => e.id));

  const related: Ranked[] = [...score.entries()]
    .filter(([id]) => !seen.has(id) && relevant(id))
    .sort((a, b) => b[1] - a[1])
    .slice(0, nRelated)
    .map(([id, s]) => ({ id, score: s }));
  related.forEach((r) => seen.add(r.id));

  let similar: Ranked[] = [];
  // "similar" only makes sense next to a real match; with none, it would list unrelated agents
  if (nSimilar > 0 && meaningRows && (exact.length > 0 || related.length > 0)) {
    similar = meaningRows
      .filter((r) => r.k === "s" && r.d > 0 && r.d <= MAX_SIMILAR_DIST && !seen.has(r.agent_id))
      .slice(0, nSimilar)
      .map((r) => ({ id: r.agent_id, score: 1 - r.d }));
  }
  return { exact, related, similar };
}
