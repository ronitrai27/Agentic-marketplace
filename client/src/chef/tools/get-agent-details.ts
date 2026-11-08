import { z } from "zod";
import { api } from "../../../convex/_generated/api";
import { tagById } from "@/lib/agent-tags";
import { chefRequest } from "./context";
import { lookupByName } from "./find-agents";

/** What the model may pass: 1 to 3 agent names, exactly as the user or find_agents gave them. */
export const GetAgentDetailsArgs = z.object({
  // First on purpose: streamed as the "thinking" line, like find_agents.
  plan: z
    .string()
    .max(240)
    .default("")
    .describe("Write this FIRST. One short sentence: which agents you are looking up and why (the user reads it)."),
  names: z
    .array(z.string().trim().min(1).max(80))
    .min(1, "give at least one agent name")
    .max(3, "at most 3 agents at a time")
    .describe('Agent names, 1 to 3 (e.g. ["Nova Research"] or ["Nova Research", "Lava Creation"]). Names only, never slugs or tasks.'),
});

export type GetAgentDetailsResult = { ok: boolean; text: string };

type Details = {
  id: string;
  slug: string;
  name: string;
  status: string;
  description: string;
  capabilities: string[];
  tags: string[];
  models: { id: string; provider?: string }[];
  inputSchemaJson: string;
  outputSchemaJson: string;
  maxTimeoutSeconds: number | null;
  streaming: boolean;
  ratingAvg: number;
  ratingCount: number;
  recentReviews: { rating: number; comment: string; likes: number; createdAt: number }[];
  totalRuns: number;
  successRuns: number;
  failedRuns: number;
  avgLatencyMs: number | null;
  lastRunAt: number | null;
  pricing: string | null;
  createdAt: number;
};

const MAX_FIELDS = 12;

/** A JSON schema as one line per top-level field: name (type, required): description [allowed values]. */
function schemaLines(json: string): string[] {
  let s: { properties?: Record<string, Record<string, unknown>>; required?: string[]; type?: string };
  try {
    s = JSON.parse(json);
  } catch {
    return ["(schema could not be read)"];
  }
  const props = Object.entries(s.properties ?? {});
  if (props.length === 0) return [`(no fields${s.type ? `, type ${s.type}` : ""})`];
  const req = new Set(s.required ?? []);
  const lines = props.slice(0, MAX_FIELDS).map(([k, p]) => {
    const type = Array.isArray(p.type) ? p.type.join("|") : String(p.type ?? (p.enum ? "enum" : "any"));
    const desc = typeof p.description === "string" ? `: ${p.description.slice(0, 120)}` : "";
    const allowed = Array.isArray(p.enum) ? ` [one of: ${p.enum.slice(0, 8).join(", ")}]` : "";
    return `${k} (${type}${req.has(k) ? ", required" : ", optional"})${desc}${allowed}`;
  });
  if (props.length > MAX_FIELDS) lines.push(`…and ${props.length - MAX_FIELDS} more fields`);
  return lines;
}

const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);

function block(d: Details): string {
  const success = d.totalRuns > 0 ? `${Math.round((d.successRuns / d.totalRuns) * 100)}%` : "n/a";
  const latency = d.avgLatencyMs !== null ? `${(d.avgLatencyMs / 1000).toFixed(1)}s` : "n/a";
  const rating = d.ratingCount > 0 ? `${Number(d.ratingAvg.toFixed(1))}` : "no rating yet";
  return [
    `AGENT: ${d.name}${d.status === "paused" ? " (paused: cannot run right now)" : ""}`,
    `Description: ${d.description}`,
    d.capabilities.length ? `Capabilities: ${d.capabilities.join("; ")}` : "Capabilities: none listed",
    `Tags: ${d.tags.map((t) => tagById(t)?.label ?? t).join(", ") || "none"}`,
    `Models: ${[...new Set(d.models.map((m) => m.id))].join(", ") || "unknown"}`,
    `Price: ${d.pricing ?? "not set"}`,
    `Rating: ${rating}`,
    `Reviews: ${d.ratingCount}`,
    `Stats: ${d.totalRuns} runs, ${success} success (${d.successRuns} ok / ${d.failedRuns} failed), avg ${latency}` +
      `${d.lastRunAt ? `, last run ${day(d.lastRunAt)}` : ""}`,
    `Limits: ${d.maxTimeoutSeconds ? `max ${d.maxTimeoutSeconds}s per run` : "default timeout"}${d.streaming ? ", streams output" : ""}`,
    `Input fields:\n${schemaLines(d.inputSchemaJson).map((l) => `  - ${l}`).join("\n")}`,
    `Output fields:\n${schemaLines(d.outputSchemaJson).map((l) => `  - ${l}`).join("\n")}`,
    d.recentReviews.length
      ? `Newest ${d.recentReviews.length} reviews:\n${d.recentReviews.map((r) => `  - ${r.rating}★ (${day(r.createdAt)}): "${r.comment}"`).join("\n")}`
      : "Newest reviews: none",
    `Listed since ${day(d.createdAt)}`,
  ].join("\n");
}

const fail = (text: string): GetAgentDetailsResult => ({ ok: false, text });

/** The get_agent_details tool. Never throws: unknown names, ambiguity and failures come back as text. */
export async function getAgentDetails(rawArgs: unknown): Promise<GetAgentDetailsResult> {
  const req = chefRequest.getStore();
  if (!req) return fail("Agent details are not available in this context. Tell the user something went wrong and to try again.");

  const parsed = GetAgentDetailsArgs.safeParse(rawArgs);
  if (!parsed.success) {
    const why = parsed.error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ");
    return fail(`The get_agent_details call was invalid (${why}). Call it again with 1 to 3 agent names.`);
  }
  const names = [...new Set(parsed.data.names)];

  try {
    const looked = await Promise.all(names.map(async (n) => ({ ref: n, ...(await lookupByName(req, n)) })));
    const notes: string[] = [];
    const ids: string[] = [];
    for (const l of looked) {
      if (l.match) {
        if (!ids.includes(l.match.id)) ids.push(l.match.id);
        if (l.match.name.toLowerCase() !== l.ref.toLowerCase()) notes.push(`"${l.ref}" was read as "${l.match.name}".`);
      } else if (l.options.length) {
        notes.push(`"${l.ref}" is ambiguous; did the user mean ${l.options.map((o) => `"${o}"`).join(" or ")}? Ask them.`);
      } else {
        notes.push(`No agent found currently named "${l.ref}". Do not guess; offer to search by task with find_agents.`);
      }
    }
    if (ids.length === 0) return fail(notes.join("\n"));

    const rows = (await req.convex.query(api.chefAgents.details, { ids })) as Details[];
    if (rows.length === 0) return fail("Those agents are no longer available (archived or suspended). Tell the user and offer to search again.");

    const many = rows.length > 1;
    const how = many
      ? `Show these ${rows.length} agents side by side in ONE markdown table: a column per agent, a row per fact ` +
        `(What it does, Capabilities, Tags, Models, Price, Rating, Reviews, Runs & success, Avg time, Input, Output). ` +
        `Rating is just the number (e.g. 3.5) and Reviews just the total count (e.g. 10); no star breakdown. Keep cells short. ` +
        `Then 1-2 sentences under the table on which suits the user's task better and why, from the descriptions.`
      : `Show this agent in ONE two-column markdown table (Field | Value): What it does, Capabilities, Tags, Models, Price, Rating, ` +
        `Reviews, Runs & success, Avg time, Input, Output. Rating is just the number (e.g. 3.5) and Reviews just the total count ` +
        `(e.g. 10); no star breakdown. Summarise schemas as field names with (required). ` +
        `Then list the newest reviews (up to 5) under the table, one short line each: rating, date and the comment.`;
    return {
      ok: true,
      text: `${notes.length ? `${notes.join("\n")}\n` : ""}${how}\nUse only these facts; say "n/a" for missing ones.\n\n${rows.map(block).join("\n\n")}`,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[chef:get_agent_details] failed:", msg);
    if (msg === "SEARCH_NOT_CONFIGURED") return fail("Agent lookup is not configured on the server. Tell the user it is unavailable right now.");
    return fail("Looking up the agent failed because of a temporary error. Tell the user briefly and offer to try again.");
  }
}
