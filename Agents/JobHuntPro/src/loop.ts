import type { Reporter } from "./events.js";
import { critic, extractProfile, verifyJobs } from "./llm.js";
import { closeFreehire, searchFreehire } from "./sources/freehire.js";
import { resetSerp, searchGlassdoor, searchGoogleJobs, serpCalls } from "./sources/serp.js";
import type { Job, Profile, VerifiedJob } from "./types.js";

const MAX_JOBS = 15;
const MIN_JOBS = 5;
const KEEP_SCORE = 70;
const PARTIAL_SCORE = 50;
const PER_ROUND_VERIFY = 24;
const BATCH = 8;
const MAX_ROUNDS = 6;

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const keyOf = (j: Job) => `${norm(j.company)}|${norm(j.title)}`;

type Kw = { term: string; jobs: number }[];
export interface Result {
  profile: Profile;
  jobs: VerifiedJob[];
  resume_keywords: { have: Kw; add: Kw };
  stats: { rounds: number; seconds: number; fetched: number; verified: number; serp_calls: number };
}

export class CanceledError extends Error {
  readonly code = "TASK_CANCELED";
  readonly retryable = false;
  constructor() {
    super("Client disconnected or run was canceled");
  }
}

export async function huntJobs(rep: Reporter, query: string, resume: string, location?: string): Promise<Result> {
  const t0 = Date.now();
  const windowMs = Number(process.env.JOBHUNT_MAX_SECONDS ?? 75) * 1000;
  const deadline = t0 + windowMs;
  resetSerp();
  const alive = () => {
    if (rep.isClosed() || rep.signal?.aborted) throw new CanceledError();
  };

  // Progress = whichever is further along: jobs found or time used. Capped at 92 until the end.
  const pct = (kept: number) => Math.min(92, 10 + 82 * Math.max(kept / MAX_JOBS, (Date.now() - t0) / windowMs));

  rep.step("Reading your role and resume");
  rep.progress(3, resume ? "Reading resume + role" : "Reading role");
  alive();
  const profile = await extractProfile(rep, query, resume);
  if (location) {
    profile.locations = [location];
    profile.queries = profile.queries.map((q) => ({ ...q, location }));
  }
  rep.emit("profile", {
    summary: profile.summary,
    roles: profile.roles,
    skills: profile.skills,
    seniority: profile.seniority,
    locations: profile.locations,
    remote: profile.remote,
  });
  rep.progress(10, `Profile ready: ${profile.roles.slice(0, 2).join(", ")}`);

  const seen = new Set<string>();
  const kept = new Map<string, VerifiedJob>();
  const rejected: VerifiedJob[] = [];
  const tried: string[] = [];
  let queries = profile.queries;
  let fetched = 0;
  let round = 0;

  const safe = async (source: string, q: string, p: Promise<Job[]>): Promise<Job[]> => {
    try {
      const jobs = await p;
      rep.activity("source_search", { source, query: q, results: jobs.length });
      return jobs;
    } catch (e) {
      if (rep.signal?.aborted) throw new CanceledError();
      rep.activity("source_error", { source, query: q, error: (e as Error).message.slice(0, 120) });
      return [];
    }
  };

  try {
    while (queries.length && Date.now() < deadline && kept.size < MAX_JOBS && round < MAX_ROUNDS) {
      alive();
      round++;
      rep.step(`Round ${round}: searching ${queries.length} queries`);
      rep.emit("round.started", { round, queries });
      rep.progress(pct(kept.size), `Round ${round}: searching`);
      queries.forEach((q) => tried.push(`${q.q} @ ${q.location}`));

      // 1. fetch every source in parallel
      const batches = await Promise.all(
        queries.flatMap((q, i) => {
          const remote = /remote/i.test(q.location) || profile.remote;
          const out = [
            safe("freehire", q.q, searchFreehire(q.q, { remote, signal: rep.signal })),
            safe("google_jobs", q.q, searchGoogleJobs(q.q, q.location, rep.signal)),
          ];
          if (i === 0) out.push(safe("glassdoor", q.q, searchGlassdoor(q.q, q.location, rep.signal)));
          return out;
        }),
      );
      alive();

      // 2. dedupe against everything seen so far
      const fresh: Job[] = [];
      for (const j of batches.flat()) {
        if (!j.title || !j.company || !j.url) continue;
        j.key = keyOf(j);
        if (seen.has(j.key)) continue;
        seen.add(j.key);
        fresh.push(j);
      }
      fetched += fresh.length;
      rep.progress(pct(kept.size), `Round ${round}: ${fresh.length} new postings, verifying`);

      // 3. verify in parallel batches (gpt-4.1-mini reads each posting vs role + resume)
      const todo = fresh.slice(0, PER_ROUND_VERIFY);
      const chunks: Job[][] = [];
      for (let i = 0; i < todo.length; i += BATCH) chunks.push(todo.slice(i, i + BATCH));
      const verified = (
        await Promise.all(
          chunks.map((c) =>
            verifyJobs(rep, profile, query, resume, c).catch((e) => {
              if (rep.signal?.aborted) throw new CanceledError();
              rep.activity("verify_error", { error: String(e.message).slice(0, 120) });
              return [] as VerifiedJob[];
            }),
          ),
        )
      ).flat();

      let added = 0;
      for (const v of verified) {
        if (v.score >= KEEP_SCORE && kept.size < MAX_JOBS) {
          kept.set(v.key, v);
          added++;
          rep.emit("job.found", {
            title: v.title, company: v.company, url: v.url, source: v.source,
            score: v.score, why_fits: v.why_fits,
          });
        } else rejected.push(v);
      }
      rep.emit("round.completed", {
        round, new_postings: fresh.length, verified: verified.length, kept_this_round: added,
        kept_total: kept.size, serp_calls: serpCalls(),
      });
      rep.progress(pct(kept.size), `Round ${round}: kept ${added}, total ${kept.size}`);

      if (kept.size >= MAX_JOBS || Date.now() >= deadline) break;

      // 4. critic reads what was kept/rejected and proposes different queries
      rep.step("Reviewing results, planning the next search");
      const c = await critic(rep, profile, tried, [...kept.values()], rejected).catch((e) => {
        if (rep.signal?.aborted) throw new CanceledError();
        return null;
      });
      queries = (c?.queries ?? []).filter((q) => !tried.includes(`${q.q} @ ${q.location}`));
      if (c) rep.activity("critic", { analysis: c.analysis, next_queries: queries });
    }
  } finally {
    await closeFreehire();
  }

  // 5. final selection: 5-15 jobs, never fabricated
  rep.step("Ranking final results");
  rep.progress(95, "Ranking final results");
  let jobs = [...kept.values()].sort((a, b) => b.score - a.score).slice(0, MAX_JOBS);
  if (jobs.length < MIN_JOBS) {
    const fill = rejected
      .filter((j) => j.score >= PARTIAL_SCORE)
      .sort((a, b) => b.score - a.score)
      .slice(0, MIN_JOBS - jobs.length)
      .map((j) => ({ ...j, partial: true }));
    jobs = [...jobs, ...fill];
  }

  return {
    profile,
    jobs,
    resume_keywords: keywords(profile, jobs),
    stats: {
      rounds: round,
      seconds: Math.round((Date.now() - t0) / 1000),
      fetched,
      verified: kept.size,
      serp_calls: serpCalls(),
    },
  };
}

/** Deterministic (no LLM): how many of the final jobs need / already match each term. */
function keywords(profile: Profile, jobs: VerifiedJob[]): { have: Kw; add: Kw } {
  const add = new Map<string, number>();
  for (const j of jobs) {
    for (const k of new Set(j.missing_keywords.map((x) => x.toLowerCase().trim()))) {
      if (k) add.set(k, (add.get(k) ?? 0) + 1);
    }
  }
  const have = profile.skills
    .map((s) => {
      const t = s.toLowerCase();
      return {
        term: t,
        jobs: jobs.filter((j) => `${j.title} ${j.description} ${j.skills.join(" ")}`.toLowerCase().includes(t)).length,
      };
    })
    .filter((x) => x.jobs > 0);
  const top = (m: Map<string, number>): Kw =>
    [...m].map(([term, jobs]) => ({ term, jobs })).sort((a, b) => b.jobs - a.jobs).slice(0, 12);
  return { have: have.sort((a, b) => b.jobs - a.jobs).slice(0, 12), add: top(add) };
}
