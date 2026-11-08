import { NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth-server";
import { AGENT_TAGS, MAX_TAGS, tagById } from "@/lib/agent-tags";
import { MIN_DESCRIPTION_WORDS, wordCount } from "@/lib/agent-description";

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const MODEL = "openai/gpt-oss-120b";
const TIMEOUT_MS = 12_000;

/** The whole tag catalogue, one line each, so the model can only pick from it. */
const CATALOGUE = AGENT_TAGS.map((t) => `${t.id}: ${t.label} (${t.group}) - ${t.keywords.join(", ")}`).join("\n");

const SYSTEM = `You tag AI agents for a marketplace. Buyers and a search assistant use the tags to match tasks to agents, so a wrong tag sends the wrong buyers.
Read the agent's description carefully: it says what the agent is built to do. Choose up to ${MAX_TAGS} tags from the catalogue that describe that job, most important first.
How to decide:
1. First name the agent's main job in your head in a few words (e.g. "writes structured reports", "audits websites for SEO", "finds open jobs"). Every tag must describe that job, its output, or a feature the description states plainly.
2. Match the job, not loose words. A keyword appearing in a tag's keyword list is NOT enough: "report" appears under Research, but an agent that WRITES reports is a writing agent, not a research agent.
3. Research, Deep Research, Fact Checking, Market Research, Competitor Analysis: only when investigating or gathering information is the agent's own main job (it searches the web, collects sources, verifies or cites facts). Never just because it produces a report, document or summary, or uses AI models.
4. Do not tag the tools or models it is built with (Claude, GPT, LangGraph...) unless the catalogue has a feature tag for exactly that and the description stresses it.
5. Return 2 to ${MAX_TAGS} tags. Look at the job from every side (what it produces, how it improves it, what the buyer gets back, features stated plainly, like file output) before settling on fewer. Return fewer than ${MAX_TAGS} only when no more truly fit; a wrong tag is worse than a missing one.
6. Only ids from the catalogue below. Never invent ids.
Examples:
- "Report writing agent. Helps create longer, structured and beautiful reports to submit. Made with Claude." -> writing tags such as content-writing, proofreading or rewriting; NOT research or deep-research.
- "Searches the web, cross-checks sources and writes a cited briefing." -> research, deep-research, fact-checking.
- "A long background job that cleans CSV files" -> data tags; NOT jobs-careers.
Reply with JSON only: {"tags": ["id1", "id2"]}

Catalogue (id: label (group) - keywords):
${CATALOGUE}`;

/** Four tag ids suggested from an agent's description (Groq gpt-oss-120b). Suggestions only: the creator picks. */
export async function POST(req: Request) {
  if (!(await isAuthenticated())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const key = process.env.GROQ_API_KEY;
  if (!key) return NextResponse.json({ error: "Tag suggestions are not configured." }, { status: 503 });

  let description = "";
  try {
    const body = (await req.json()) as { description?: unknown };
    description = typeof body.description === "string" ? body.description.trim().slice(0, 2000) : "";
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  if (wordCount(description) < MIN_DESCRIPTION_WORDS) {
    return NextResponse.json({ error: `Write at least ${MIN_DESCRIPTION_WORDS} words first.` }, { status: 400 });
  }

  try {
    // Groq's free tier allows ~3 suggestions a minute: on a 429, wait the time it asks for (max 4s) and try once more.
    let res = await askGroq(key, description);
    if (res.status === 429) {
      const wait = Math.min(4000, Math.ceil(Number(res.headers.get("retry-after") ?? "2") * 1000) || 2000);
      await new Promise((r) => setTimeout(r, wait));
      res = await askGroq(key, description);
    }
    if (!res.ok) {
      console.error("[suggest-tags] groq", res.status, (await res.text()).slice(0, 300));
      const busy = res.status === 429;
      return NextResponse.json(
        { error: busy ? "Tag suggestions are busy, try Refresh in a few seconds." : "Could not suggest tags right now." },
        { status: busy ? 429 : 502 },
      );
    }
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const parsed = JSON.parse(data.choices?.[0]?.message?.content ?? "{}") as { tags?: unknown };
    const tags = [...new Set(Array.isArray(parsed.tags) ? parsed.tags.map(String) : [])]
      .filter((id) => tagById(id))
      .slice(0, MAX_TAGS);
    return NextResponse.json({ tags });
  } catch (e) {
    console.error("[suggest-tags] failed:", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "Could not suggest tags right now." }, { status: 502 });
  }
}

function askGroq(key: string, description: string): Promise<Response> {
  return fetch(GROQ_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.2,
        reasoning_effort: "low",
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: `Agent description:\n"""${description}"""` },
        ],
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
}
