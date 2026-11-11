import { z } from "zod";

export interface Job {
  key: string; // dedupe key
  title: string;
  company: string;
  location: string;
  url: string;
  source: "freehire" | "google_jobs" | "glassdoor";
  description: string; // possibly truncated
  skills: string[];
}

export const ProfileSchema = z.object({
  summary: z.string().describe("One sentence: who this person is professionally"),
  roles: z.array(z.string()).describe("Target job titles, most specific first"),
  skills: z.array(z.string()).describe("Core skills/technologies, lowercase"),
  seniority: z.string().describe("intern|junior|middle|senior|lead|staff|unknown"),
  locations: z.array(z.string()).describe("Preferred locations; empty if unstated"),
  remote: z.boolean().describe("true if remote is wanted or acceptable"),
  queries: z.array(z.object({ q: z.string(), location: z.string() })).min(1).max(3)
    .describe("2-3 short job-board search queries (<=5 words each) with a location ('Remote' if remote)"),
});
export type Profile = z.infer<typeof ProfileSchema>;

export const VerifySchema = z.object({
  results: z.array(z.object({
    id: z.number().describe("The numeric id given in the input"),
    score: z.number().min(0).max(100).describe("How well the posting fits the user's role + resume"),
    why_fits: z.string().describe("<=25 words, citing concrete overlap with the resume/role"),
    missing_keywords: z.array(z.string()).max(6).describe("Skills/keywords the posting asks for that the resume lacks"),
    reject_reason: z.string().describe("Empty if it fits; else <=12 words why it does not"),
  })),
});

export const CriticSchema = z.object({
  analysis: z.string().describe("<=25 words: why results are thin or off-target"),
  queries: z.array(z.object({ q: z.string(), location: z.string() })).max(3)
    .describe("New queries that differ from all previous ones"),
});

export interface VerifiedJob extends Job {
  score: number;
  why_fits: string;
  missing_keywords: string[];
  reject_reason: string;
  partial?: boolean;
}
