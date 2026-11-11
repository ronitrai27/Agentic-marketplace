import type { Job } from "../types.js";

let calls = 0;
export const serpCalls = () => calls;
export const resetSerp = () => (calls = 0);
const cap = () => Number(process.env.JOBHUNT_MAX_SERP_CALLS ?? 8);

async function serp(engine: string, params: Record<string, string>, signal?: AbortSignal): Promise<any[]> {
  if (!process.env.SERPAPI_KEY) throw new Error("SERPAPI_KEY missing");
  if (calls >= cap()) return [];
  calls++;
  const u = new URL("https://serpapi.com/search.json");
  u.searchParams.set("engine", engine);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  u.searchParams.set("api_key", process.env.SERPAPI_KEY);
  const res = await fetch(u, { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(25_000)]) : AbortSignal.timeout(25_000) });
  const j: any = await res.json();
  if (j.error && !/hasn't returned any results/i.test(j.error)) throw new Error(`serpapi ${engine}: ${j.error}`);
  return j.jobs_results ?? [];
}

export async function searchGoogleJobs(q: string, location: string, signal?: AbortSignal): Promise<Job[]> {
  const rows = await serp("google_jobs", { q, ...(location && location !== "Remote" ? { location } : {}) }, signal);
  return rows.map((j) => ({
    key: "",
    title: j.title,
    company: j.company_name,
    location: j.location ?? "",
    url: j.apply_options?.[0]?.link ?? j.source_link ?? j.share_link ?? "",
    source: "google_jobs" as const,
    description: String(j.description ?? "").slice(0, 1500),
    skills: [],
  }));
}

export async function searchGlassdoor(q: string, location: string, signal?: AbortSignal): Promise<Job[]> {
  const rows = await serp("glassdoor_jobs", { q, location: location || "Remote" }, signal);
  return rows.map((j) => ({
    key: "",
    title: j.title,
    company: j.company_name,
    location: j.location ?? "",
    url: j.link ?? "",
    source: "glassdoor" as const,
    description: String(j.snippet ?? ""),
    skills: j.skills ?? [],
  }));
}
