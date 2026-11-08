import { AGENT_TAGS } from "@/lib/agent-tags";
import { normalize } from "@/lib/search-text";
import { ensureSearchSchema, searchPool } from "./db";
import { embedQuery, toVector } from "./embed";

/**
 * The chef's task search: "which agents are BUILT for this job?". Separate from `searchRanked` (the search bar),
 * which is about names and tags people type. Here the description decides, with tags as the second voice:
 *  - meaning: the query against each agent's description + capabilities + tag labels (`task_embedding`, no name)
 *  - tags:    a tag whose label or keyword phrase is in the query moves its agents a little closer
 * Names are ignored, and loose single keywords never count ("background jobs" is not "find me jobs").
 *
 * Measured on the live catalogue (text-embedding-3-small cosine distance): the right agent sits at 0.41-0.60 and an
 * agent built for something else 0.64+. Good matches for long, specific asks can still sit near 0.70, so the cut is
 * relative to the best match, not a fixed number.
 */
export type TaskHit = {
  id: string;
  /** Cosine distance after the tag bonus; lower is closer. */
  distance: number;
  /** 0..1, 1 = the best match of this search. */
  relevance: number;
  /** Tag ids of this agent that the query asked for. */
  tagHits: string[];
};

/** Past this, even the best agent is not doing this task. */
const MAX_DIST = 0.78;
/** Kept only within this distance of the best match: a clearly better fit means the others are built for something else. */
const GAP = 0.08;
/** Distance taken off per tag the query asks for (at most 2). */
const TAG_BONUS = 0.025;
const POOL = 20;

const stem = (w: string) => (w.length > 3 && w.endsWith("s") ? w.slice(0, -1) : w);
const phrase = (s: string) => ` ${normalize(s).split(" ").map(stem).join(" ")} `;
/** Label words too broad to name a tag on their own. */
const BROAD = new Set(["and", "check", "tool", "data", "content", "file", "web", "long", "multi", "verified", "result", "agent", "deep", "team"]);

/**
 * Tags the query asks for: a whole label or keyword phrase appears in it ("site audit", "resume"), or a distinctive
 * word of the label does ("audit" -> Website Audit, "jobs" -> Jobs & Careers).
 */
export function queryTags(q: string): Set<string> {
  const text = phrase(q);
  const out = new Set<string>();
  for (const t of AGENT_TAGS) {
    const byPhrase = [t.label, ...t.keywords].some((p) => normalize(p).length >= 3 && text.includes(phrase(p)));
    const byLabelWord = phrase(t.label)
      .trim()
      .split(" ")
      .some((w) => w.length >= 3 && !BROAD.has(w) && text.includes(` ${w} `));
    if (byPhrase || byLabelWord) out.add(t.id);
  }
  return out;
}

/**
 * The ask without chat filler ("okay help me find all agents that can ..."), so the embedding is about the job.
 * Filler words pull every agent toward the query by the same amount and blur the gap between right and wrong.
 */
export function taskOnly(q: string): string {
  const t = normalize(q)
    .replace(/\b(okay|ok|hey|hi|hello|please|pls|kindly|thanks|thank you)\b/g, " ")
    .replace(/\b(can you|could you|would you|will you)\b/g, " ")
    .replace(/\b(help me|suggest me|show me|give me|get me|tell me|i want|i need|we need|we want|looking for|search for|find me|find)\b/g, " ")
    .replace(/\b(all|some|any|the best|best|top|good|an|a|the)?\s*(ai )?(agents?|tools?|bots?)\b( that| which| who| to)?( can| could| will)?\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return t.split(" ").length >= 2 ? t : normalize(q); // too little left: keep the original
}

/** Null when the query could not be embedded (OpenAI slow or down); the caller then says search is unavailable. */
export async function searchTask(q: string, limit = 6): Promise<TaskHit[] | null> {
  await ensureSearchSchema();
  const vec = await embedQuery(taskOnly(q));
  if (!vec) return null;

  const { rows } = await searchPool().query(
    `select agent_id, tags, task_embedding <=> $1::vector as d
       from agent_search where task_embedding is not null
      order by d limit ${POOL}`,
    [toVector(vec)],
  );
  const wanted = queryTags(q);
  const scored = (rows as { agent_id: string; tags: string[]; d: number }[]).map((r) => {
    const tagHits = r.tags.filter((t) => wanted.has(t));
    return { id: r.agent_id, distance: Number(r.d) - TAG_BONUS * Math.min(2, tagHits.length), tagHits };
  });
  scored.sort((a, b) => a.distance - b.distance);
  const best = scored[0]?.distance;
  if (best === undefined || best > MAX_DIST) return [];

  return scored
    .filter((s) => s.distance <= Math.min(MAX_DIST, best + GAP))
    .slice(0, limit)
    .map((s) => ({ ...s, relevance: 1 - (s.distance - best) / GAP }));
}
