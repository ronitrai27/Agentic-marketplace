import { z } from "zod";
import { api } from "../../../convex/_generated/api";
import { searchRanked } from "@/search/query";
import { ensureIndexed, ensureTaskIndexed } from "@/search/sync";
import { searchTask } from "@/search/task";
import { chefRequest, type ChefRequest } from "./context";
import { parseSelection } from "./selection";

/** What the model may pass. Anything else is rejected with a readable message, never thrown. */
export const FindAgentsArgs = z.object({
  // First on purpose: the model writes it first, so the UI can stream it as the "thinking" line right away.
  plan: z
    .string()
    .max(240)
    .default("")
    .describe("Write this FIRST. One short sentence: what the user wants and how you will search (the user reads it)."),
  query: z
    .string()
    .trim()
    .min(1, "query is empty")
    .max(200)
    .describe(
      "The task in the user's own words (e.g. research the Indian SaaS market) or the agent name they gave (e.g. Nova research).",
    ),
  mode: z
    .enum(["task", "name"])
    .default("task")
    .describe(
      'Use "name" ONLY when the user gave a specific agent name, even misspelled (e.g. "Nova research", "job fit agent"). ' +
        'Descriptions such as "best research agent" or "an agent for reports" are tasks: use "task". When unsure, use "task".',
    ),
  limit: z.number().int().min(1).max(6).default(6).describe("How many agents to return (max 6)."),
});
export type FindAgentsArgs = z.infer<typeof FindAgentsArgs>;

/** The only agent facts the user sees in the picker. */
export type AgentCard = {
  slug: string;
  name: string;
  logoUrl?: string;
  ratingAvg: number;
  ratingCount: number;
  models: { id: string; provider?: string }[];
};

export type FindAgentsResult = {
  ok: boolean;
  /** Plain text for the model: what was found, or exactly what went wrong and what to do next. */
  text: string;
  agents: AgentCard[];
  /** The user has to pick (several candidates). False when one agent is a clear match. */
  needsChoice: boolean;
  /** Slug to highlight first (the exact name match, or the best ranked). */
  preselect?: string;
};

type Enriched = {
  id: string;
  slug: string;
  name: string;
  description: string;
  capabilities: string[];
  logoUrl?: string;
  tags: string[];
  models: { id: string; provider?: string }[];
  ratingAvg: number;
  ratingCount: number;
  totalRuns: number;
  successRate: number | null;
  avgLatencyMs: number | null;
  pricingShape: string | null;
  priceFromMicros: number | null;
};

// ─── names ───

/** "Nova  Research!" and "nova-research" are the same name. */
export function normName(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** "i want the nova research agent" -> "nova research". Only a second try when the model's query finds nothing exact. */
function cleanRef(text: string): string {
  return normName(text)
    .replace(/^(please |pls )?(i |we )?(want|need|use|run|pick|choose|select|try|get|give me|show me|find)( me)?( to use)? /, "")
    .replace(/^(the|an|a) /, "")
    .replace(/ (agent|agents)$/, "")
    .replace(/^agent /, "")
    .trim();
}

function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  const dp: number[][] = Array.from({ length: a.length + 1 }, (_, i) => {
    const row = new Array<number>(b.length + 1).fill(0);
    row[0] = i;
    return row;
  });
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[a.length][b.length];
}

/** How close an agent's name is to what the user typed, 0..1. 1 = same name once normalised. */
export function nameSimilarity(name: string, ref: string): number {
  const n = normName(name);
  const r = normName(ref);
  if (!r || !n) return 0;
  if (n === r) return 1;
  if (n.startsWith(r) || r.startsWith(n)) return 0.9;
  const typo = 1 - editDistance(n, r) / Math.max(n.length, r.length);
  const nt = new Set(n.split(" "));
  const rt = r.split(" ");
  const overlap = rt.filter((t) => nt.has(t)).length / Math.max(nt.size, rt.length);
  return Math.max(typo, overlap * 0.8);
}

// ─── ranking ───

const PRIOR_RATING = 3.5;
const PRIOR_WEIGHT = 3;

/**
 * Relevance decides; track record only breaks ties between agents that fit about equally.
 * `fit` is 0.7..1 (1 = best match of the search), so the most a perfect record can add (x1.0 vs x0.85) never lifts
 * an edge match over the best one: reviews and runs cannot push the wrong agent to the top.
 */
function rank(a: Enriched, fit: number): { score: number; reasons: string[] } {
  const bayes = (a.ratingCount * a.ratingAvg + PRIOR_WEIGHT * PRIOR_RATING) / (a.ratingCount + PRIOR_WEIGHT);
  const quality = (bayes - 1) / 4;
  const reliability = a.successRate ?? 0.5;
  const speed = a.avgLatencyMs === null ? 0.5 : 1 / (1 + a.avgLatencyMs / 20_000);
  const record = 0.5 * quality + 0.35 * reliability + 0.15 * speed;
  const score = fit * (0.85 + 0.15 * record);

  const reasons: string[] = [];
  if (fit >= 0.95) reasons.push("description matches the task best");
  else if (fit >= 0.85) reasons.push("description is a close match for the task");
  if (a.ratingCount >= 5 && a.ratingAvg >= 4.3) reasons.push(`well reviewed (${a.ratingAvg.toFixed(1)} stars, ${a.ratingCount} reviews)`);
  else if (a.ratingCount === 0) reasons.push("no reviews yet");
  if (a.successRate !== null && a.totalRuns >= 10 && a.successRate >= 0.95) reasons.push(`${Math.round(a.successRate * 100)}% of runs succeed`);
  if (a.avgLatencyMs !== null && a.avgLatencyMs < 10_000) reasons.push("fast");
  return { score, reasons };
}

const usd = (micros: number) => `$${(micros / 1_000_000).toFixed(2)}`;

function line(i: number, a: Enriched, reasons: string[]): string {
  const parts = [
    a.capabilities.length ? `does: ${a.capabilities.slice(0, 4).join("; ")}` : null,
    a.ratingCount > 0 ? `${a.ratingAvg.toFixed(1)} stars from ${a.ratingCount} review${a.ratingCount === 1 ? "" : "s"}` : "no reviews yet",
    a.successRate !== null ? `${Math.round(a.successRate * 100)}% success over ${a.totalRuns} runs` : "no runs yet",
    a.avgLatencyMs !== null ? `avg ${(a.avgLatencyMs / 1000).toFixed(1)}s` : null,
    a.priceFromMicros !== null ? `from ${usd(a.priceFromMicros)} (${a.pricingShape?.replace("_", " ")})` : null,
    a.models.length ? `models: ${[...new Set(a.models.map((m) => m.id))].join(", ")}` : null,
  ].filter(Boolean);
  // the description is what the model judges the fit on, so it gets most of it
  const desc = a.description.length > 400 ? `${a.description.slice(0, 397)}…` : a.description;
  return `${i}. ${a.name} — ${desc}\n   ${parts.join(" · ")}${reasons.length ? `\n   why: ${reasons.join("; ")}` : ""}`;
}

const toCard = (a: Enriched): AgentCard => ({
  slug: a.slug,
  name: a.name,
  logoUrl: a.logoUrl,
  ratingAvg: a.ratingAvg,
  ratingCount: a.ratingCount,
  models: a.models,
});

const fail = (text: string): FindAgentsResult => ({ ok: false, text, agents: [], needsChoice: false });

// ─── search + enrich ───

/** True when the search database could not be reached at all (network, firewall, paused database), as opposed to a bug. */
function isConnectionError(e: unknown): boolean {
  const errs = e instanceof AggregateError ? [e, ...e.errors] : [e];
  return errs.some((x) => {
    const code = (x as { code?: string } | null)?.code;
    if (code && ["ETIMEDOUT", "ECONNREFUSED", "ECONNRESET", "ENOTFOUND", "EHOSTUNREACH", "ENETUNREACH", "EAI_AGAIN"].includes(code)) return true;
    const msg = x instanceof Error ? x.message : String(x);
    return /timeout exceeded when trying to connect|connection terminated|connect ETIMEDOUT|getaddrinfo/i.test(msg);
  });
}

/** Requests that fell back to Convex because the main search database was down. */
const degraded = new WeakSet<ChefRequest>();

/** The model must tell the user why this took longer, so nobody blames the app. */
const DEGRADED_NOTE =
  "NOTE for the user: the main search database was unreachable, so the answer came from a simpler name match and took a few extra seconds. " +
  "Say this in one short, friendly sentence and apologise for the wait.";

/** Name match straight from Convex, when the main search database is down. Names only: no meaning search. */
async function convexNameCandidates(req: ChefRequest, q: string) {
  const all = (await req.convex.query(api.chefAgents.listForIndex, {})) as { id: string; name: string }[];
  const near = all
    .map((a) => ({ id: a.id, sim: nameSimilarity(a.name, q) }))
    .filter((c) => c.sim >= 0.55)
    .sort((x, y) => y.sim - x.sim)
    .slice(0, 8);
  if (near.length === 0) return [];
  const rows = (await req.convex.query(api.chefAgents.enrich, { ids: near.map((c) => c.id) })) as Enriched[];
  const byId = new Map(rows.map((r) => [r.id, r]));
  return near.flatMap((c, i) => {
    const a = byId.get(c.id);
    return a ? [{ a, fit: Math.max(0.2, 1 - i * 0.07) }] : [];
  });
}

/** How long the search database gets before the user is told it is slow. */
const SLOW_DB_NOTICE_MS = 5_000;
const noticed = new WeakSet<ChefRequest>();

/** Runs a database step; if it is still waiting after a few seconds, the user gets a toast so they know why it is slow. */
async function withSlowNotice<T>(req: ChefRequest, fn: () => Promise<T>): Promise<T> {
  const timer = setTimeout(() => {
    if (noticed.has(req)) return;
    noticed.add(req);
    req.notify?.("notice", {
      level: "warning",
      title: "Temporary network failure",
      description: "Our search database is slow to respond, so this may take a little longer than usual.",
    });
  }, SLOW_DB_NOTICE_MS);
  try {
    return await fn();
  } finally {
    clearTimeout(timer);
  }
}

/** Name lookup. Uses the search index; when the database is unreachable it matches names in Convex instead. */
async function candidates(req: ChefRequest, q: string) {
  if (degraded.has(req)) return convexNameCandidates(req, q); // already known to be down: do not wait again
  try {
    return await withSlowNotice(req, () => indexCandidates(req, q));
  } catch (e) {
    if (!isConnectionError(e)) throw e;
    console.error("[chef:find_agents] search database unreachable, matching names in Convex:", e instanceof Error ? e.message : e);
    degraded.add(req);
    return convexNameCandidates(req, q);
  }
}

/** Index candidates in name order, then Convex facts. Archived and suspended agents do not survive the Convex step. */
async function indexCandidates(req: ChefRequest, q: string) {
  await ensureIndexed(req.convex); // waits only when the index is empty; otherwise refreshes in the background
  const found = await searchRanked(q, { exact: 6, related: 8, similar: 0 });

  const ordered: { id: string }[] = [];
  const seen = new Set<string>();
  for (const h of [...found.exact, ...found.related]) {
    if (!h.id || seen.has(h.id)) continue;
    seen.add(h.id);
    ordered.push(h);
  }
  const out: { a: Enriched; fit: number }[] = [];
  if (ordered.length === 0) return out;

  const rows = (await req.convex.query(api.chefAgents.enrich, { ids: ordered.map((h) => h.id) })) as Enriched[];
  const byId = new Map(rows.map((r) => [r.id, r]));
  ordered.forEach((h, i) => {
    const a = byId.get(h.id); // archived and suspended agents have no row here
    if (!a) return;
    out.push({ a, fit: Math.max(0.2, 1 - i * 0.07) });
  });
  return out;
}

/**
 * One agent by name for get_agent_details: the exact name, or a single clearly closest name (typos, "nova").
 * When several names are about as close, nothing is picked and `options` lists them.
 */
export async function lookupByName(req: ChefRequest, ref: string): Promise<{ match?: { id: string; name: string }; options: string[] }> {
  const pool = await candidates(req, ref);
  const exact = pool.find((c) => normName(c.a.name) === normName(ref));
  if (exact) return { match: { id: exact.a.id, name: exact.a.name }, options: [] };
  const close = pool
    .map((c) => ({ a: c.a, sim: nameSimilarity(c.a.name, ref) }))
    .filter((c) => c.sim >= 0.55)
    .sort((x, y) => y.sim - x.sim);
  const [first, second] = close;
  if (first && first.sim >= 0.7 && (!second || first.sim - second.sim >= 0.1)) {
    return { match: { id: first.a.id, name: first.a.name }, options: [] };
  }
  return { options: close.slice(0, 4).map((c) => c.a.name) };
}

/** Find the agent the user named (exact or approximate), whatever the model passed. */
async function byName(req: ChefRequest, modelQuery: string, limit: number, strict: boolean): Promise<FindAgentsResult> {
  const refs = [...new Set([modelQuery, cleanRef(req.lastUserText)].filter((r) => normName(r).length >= 2))];
  let pool: { a: Enriched; fit: number }[] = [];
  let exact: Enriched | undefined;
  let usedRef = refs[0] ?? modelQuery;

  for (const ref of refs) {
    const found = await candidates(req, ref);
    const hit = found.find((c) => normName(c.a.name) === normName(ref));
    if (!pool.length || hit) {
      pool = found;
      usedRef = ref;
    }
    if (hit) {
      exact = hit.a;
      break;
    }
  }

  if (strict) {
    // the user clicked a card: one agent, by exact name, no more questions
    return exact
      ? {
          ok: true,
          text: `The user selected "${exact.name}".\n${line(1, exact, [])}`,
          agents: [toCard(exact)],
          needsChoice: false,
          preselect: exact.slug,
        }
      : fail(
          `The user selected "${usedRef}" but no agent found currently has exactly that name. Tell them it is no longer available and offer to search again.`,
        );
  }

  const similar = pool
    .map((c) => ({ a: c.a, sim: nameSimilarity(c.a.name, usedRef) }))
    .filter((c) => c.sim >= 0.55 && c.a.id !== exact?.id)
    .sort((x, y) => y.sim - x.sim)
    .map((c) => c.a);

  const list = [...(exact ? [exact] : []), ...similar].slice(0, limit);
  if (list.length === 0 && degraded.has(req)) {
    // Database down: only names could be checked, which is enough to say nothing is called that
    return fail(
      `No agent found currently with a name like "${usedRef}". Tell the user plainly that no agent has that name. ${DEGRADED_NOTE} ` +
        `Offer to search by the task they need done once things are back to normal.`,
    );
  }
  if (list.length === 0) {
    // Nothing is called that. The model may have used "name" for what is really a task ("bestresearch agent"),
    // so search by meaning before giving up; only when that finds nothing too is it "No agent found currently".
    const byMeaning = await byTask(req, usedRef, limit);
    if (byMeaning.ok) {
      return { ...byMeaning, text: `No agent is named "${usedRef}", so this is a search by meaning instead.
${byMeaning.text}` };
    }
    return fail(
      `No agent found currently with a name like "${usedRef}". Tell the user: "No agent found currently." Do not guess a name; offer to search by the task they need done instead.`,
    );
  }

  const needsChoice = list.length > 1;
  const head = exact
    ? needsChoice
      ? `Exact match "${exact.name}", plus ${list.length - 1} similarly named. The user will pick one in the card list.`
      : `Exact match "${exact.name}". It is the only agent with that name.`
    : `No agent is named exactly "${usedRef}". Closest names (the user will pick one in the card list):`;
  return {
    ok: true,
    text: `${head}\n${list.map((a, i) => line(i + 1, a, [])).join("\n")}${degraded.has(req) ? `\n${DEGRADED_NOTE}` : ""}`,
    agents: list.map(toCard),
    needsChoice,
    preselect: exact?.slug ?? list[0].slug,
  };
}

/** Task search: by what each agent is built for (description + tags), not by name. Only agents that fit come back. */
async function taskCandidates(req: ChefRequest, q: string, limit: number): Promise<{ a: Enriched; fit: number }[]> {
  const hits = await withSlowNotice(req, async () => {
    await ensureTaskIndexed(req.convex);
    return searchTask(q, limit);
  });
  if (hits === null) throw new Error("TASK_SEARCH_UNAVAILABLE");
  if (hits.length === 0) return [];
  const rows = (await req.convex.query(api.chefAgents.enrich, { ids: hits.map((h) => h.id) })) as Enriched[];
  const byId = new Map(rows.map((r) => [r.id, r]));
  return hits.flatMap((h) => {
    const a = byId.get(h.id); // archived and suspended agents have no row here
    return a ? [{ a, fit: 0.7 + 0.3 * h.relevance }] : [];
  });
}

async function byTask(req: ChefRequest, query: string, limit: number): Promise<FindAgentsResult> {
  const found = await taskCandidates(req, query, limit);
  if (found.length === 0) {
    return fail(
      `No agent found currently for "${query}". Tell the user: "No agent found currently." and suggest describing the task differently (what to do, for whom, the output they want).`,
    );
  }
  const ranked = found
    .map(({ a, fit }) => ({ a, ...rank(a, fit) }))
    .sort((x, y) => y.score - x.score)
    .slice(0, limit);
  return {
    ok: true,
    text:
      (ranked.length === 1
        ? `One agent is built for "${query}"; the others in the catalogue do different jobs. The user sees it as a card, so do not list it again; ` +
          `say in a sentence why it fits (from its description).\n`
        : `${ranked.length} agents fit "${query}", best first; agents built for other jobs were left out. The user sees them as selectable cards ` +
          `and picks one, so do not list them again; say in a sentence or two which looks best and why, based on what each description says it does.\n`) +
      ranked.map((r, i) => line(i + 1, r.a, r.reasons)).join("\n"),
    agents: ranked.map((r) => toCard(r.a)),
    needsChoice: ranked.length > 1,
    preselect: ranked[0].a.slug,
  };
}

/**
 * The find_agents tool. Never throws: bad arguments, an empty result, or a failing service each come back as
 * text the model can reason about.
 */
export async function findAgents(rawArgs: unknown): Promise<FindAgentsResult> {
  const req = chefRequest.getStore();
  if (!req) return fail("The agent search is not available in this context. Tell the user something went wrong and to try again.");

  const parsed = FindAgentsArgs.safeParse(rawArgs);
  if (!parsed.success) {
    const why = parsed.error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ");
    return fail(`The find_agents call was invalid (${why}). Call it again with a short query and mode "task" or "name".`);
  }
  const { query, mode, limit } = parsed.data;

  try {
    // a card the user clicked beats whatever the model wrote
    const picked = parseSelection(req.lastUserText);
    if (picked) return await byName(req, picked, limit, true);
    return mode === "name" ? await byName(req, query, limit, false) : await byTask(req, query, limit);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[chef:find_agents] failed:", msg);
    if (msg === "SEARCH_NOT_CONFIGURED") {
      return fail("Agent search is not configured on the server. Tell the user it is unavailable right now; do not invent agents.");
    }
    if (isConnectionError(e)) {
      return fail(
        "The agent search could not run: the search database is unreachable (a network or connection problem on our side, not a missing agent). " +
          "Tell the user exactly that, apologise for the delay, do not claim the agent does not exist, do not invent agents, and offer to try again.",
      );
    }
    return fail("Agent search failed because of an unexpected error. Tell the user briefly, do not invent agents, and offer to try again.");
  }
}
