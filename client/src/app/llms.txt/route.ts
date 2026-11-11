import { connection } from "next/server";
import { fetchQuery } from "convex/nextjs";
import { api } from "../../../convex/_generated/api";
import { MCP_URL, SITE_DESCRIPTION, SITE_NAME, SITE_TAGLINE, SITE_URL } from "@/lib/site";

const oneLine = (s: string, n = 200) => s.replace(/\s+/g, " ").trim().slice(0, n);

/** llms.txt: a plain-markdown map of the site for LLM crawlers and answer engines. */
export async function GET() {
  await connection();
  let agents: Awaited<ReturnType<typeof loadAgents>> = [];
  try {
    agents = await loadAgents();
  } catch {
    /* ship the static part if Convex is unreachable */
  }

  const lines = [
    `# ${SITE_NAME}`,
    "",
    `> ${SITE_TAGLINE}. ${SITE_DESCRIPTION}`,
    "",
    "## What Catelog is",
    "",
    "- A marketplace where creators publish AI agents and users run them on demand.",
    "- Credits are the currency (100 credits = $1). A run is held in escrow and charged only if it succeeds.",
    "- Every run is approved by the user, with a maximum cost shown up front.",
    "- Agents can be run from the web app or from any MCP-compatible AI assistant.",
    "",
    "## Key pages",
    "",
    `- [Home](${SITE_URL}/): overview of the marketplace`,
    `- [Marketplace](${SITE_URL}/space/marketplace): browse and compare agents by price, rating and success rate`,
    `- [Sitemap](${SITE_URL}/sitemap.xml)`,
    "",
    "## Use Catelog from an AI assistant (MCP)",
    "",
    MCP_URL ? `- MCP server (streamable HTTP, OAuth): ${MCP_URL}` : "- MCP server: streamable HTTP with OAuth sign-in",
    "- Tools: `discover_agents` (search), `get_agents_schema` (input/output schema and pricing), `run_agent` (request a run), `get_run` (status and output), `get_wallet_info` (balance)",
    "- Workflow: discover_agents -> get_agents_schema -> run_agent -> user approves in Catelog -> get_run returns the output",
    "",
  ];

  if (agents.length) {
    lines.push("## Agents", "");
    for (const a of agents) {
      const rating = a.ratingCount > 0 ? ` Rated ${a.ratingAvg.toFixed(1)}/5 (${a.ratingCount}).` : "";
      lines.push(`- [${a.name}](${SITE_URL}/space/marketplace/${encodeURIComponent(a.slug)}): ${oneLine(a.description)}${rating}`);
    }
    lines.push("");
  }

  return new Response(lines.join("\n"), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
    },
  });
}

async function loadAgents() {
  const all = await fetchQuery(api.agents.listMarketplace, {});
  // Best-rated and busiest first; cap so the file stays small.
  return [...all].sort((a, b) => b.ratingAvg - a.ratingAvg || b.totalRuns - a.totalRuns).slice(0, 100);
}
