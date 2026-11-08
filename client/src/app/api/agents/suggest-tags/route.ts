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
Read the agent's description carefully: it says what the agent is built to do. Choose the ${MAX_TAGS} tags from the catalogue that best describe that job, most important first.
Rules:
- Only ids from the catalogue below. Never invent ids.
- Tag what the agent DOES for the buyer (its main job and output), not words that merely appear (a "long background job" is not about jobs or careers).
- Prefer category tags for the main job; use feature tags only when the description clearly states that feature.
Reply with JSON only: {"tags": ["id1", "id2", "id3", "id4"]}

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
    const res = await fetch(GROQ_URL, {
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
    if (!res.ok) {
      console.error("[suggest-tags] groq", res.status, (await res.text()).slice(0, 300));
      return NextResponse.json({ error: "Could not suggest tags right now." }, { status: 502 });
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
