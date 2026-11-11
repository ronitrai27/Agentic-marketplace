import { generateObject } from "ai";
import type { Reporter } from "./events.js";
import { haiku, mini } from "./models.js";
import { recordUsage } from "./telemetry.js";
import {
  CriticSchema, ProfileSchema, VerifySchema,
  type Job, type Profile, type VerifiedJob,
} from "./types.js";

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) + "…" : s);

const brief = (p: Profile) =>
  JSON.stringify({ roles: p.roles, skills: p.skills, seniority: p.seniority, locations: p.locations, remote: p.remote });

/** Haiku: resume/query -> structured profile + first search queries. */
export async function extractProfile(rep: Reporter, query: string, resume: string): Promise<Profile> {
  const t = Date.now();
  const res = await generateObject({
    abortSignal: rep.signal,
    model: haiku(),
    schema: ProfileSchema,
    maxOutputTokens: 700,
    system:
      "You turn a job-seeker's request and optional resume into a search profile. The user's request overrides the resume. Never invent skills that are not in the input.",
    prompt: `Request: ${query}\n\nResume:\n${resume ? clip(resume, 8000) : "(none)"}`,
  });
  recordUsage(rep, "anthropic", res, process.env.HAIKU_MODEL || "claude-haiku-5-5", t);
  return res.object;
}

/** gpt-4.1-mini: read postings, judge fit against role + resume. */
export async function verifyJobs(
  rep: Reporter, profile: Profile, query: string, resume: string, jobs: Job[],
): Promise<VerifiedJob[]> {
  const t = Date.now();
  const list = jobs
    .map(
      (j, i) =>
        `#${i} ${j.title} @ ${j.company} (${j.location})\nskills: ${j.skills.join(", ") || "n/a"}\n${clip(j.description, 900)}`,
    )
    .join("\n---\n");
  const res = await generateObject({
    abortSignal: rep.signal,
    model: mini(),
    schema: VerifySchema,
    maxOutputTokens: 2500,
    system:
      "You verify job postings against a candidate. Judge ONLY from the posting text and the candidate info; never assume facts that are not written. " +
      "Score 80+ only if the role, seniority, location/remote and core skills all line up. Score below 55 if the role family, seniority or location clearly clash. " +
      "missing_keywords = concrete skills/tools the posting asks for that the candidate does not show.",
    prompt: `Candidate wants: ${query}\nProfile: ${brief(profile)}\nResume:\n${resume ? clip(resume, 5000) : "(none)"}\n\nPostings:\n${list}\n\nReturn one result per posting id (the number after #).`,
  });
  recordUsage(rep, "openai", res, process.env.MINI_MODEL || "gpt-4.1-mini", t);
  const byId = new Map(res.object.results.map((r) => [r.id, r]));
  return jobs.flatMap((j, i) => {
    const r = byId.get(i);
    return r
      ? [{ ...j, score: r.score, why_fits: r.why_fits, missing_keywords: r.missing_keywords, reject_reason: r.reject_reason }]
      : [];
  });
}

/** Haiku: look at what was found/rejected and propose different queries. */
export async function critic(rep: Reporter, profile: Profile, tried: string[], kept: VerifiedJob[], rejected: VerifiedJob[]) {
  const t = Date.now();
  const res = await generateObject({
    abortSignal: rep.signal,
    model: haiku(),
    schema: CriticSchema,
    maxOutputTokens: 500,
    system:
      "You are a search strategist. Given verified and rejected jobs, find why the search is thin and propose 2-3 NEW queries (different titles, synonyms, stack or location) that are not in the tried list. Keep queries short (5 words max).",
    prompt: `Profile: ${brief(profile)}\nTried: ${tried.join(" | ")}\nKept (${kept.length}): ${kept.slice(0, 8).map((j) => j.title).join(" | ")}\nRejected (${rejected.length}) reasons: ${rejected.slice(0, 12).map((j) => `${j.title}: ${j.reject_reason}`).join(" | ")}`,
  });
  recordUsage(rep, "anthropic", res, process.env.HAIKU_MODEL || "claude-haiku-5-5", t);
  return res.object;
}
