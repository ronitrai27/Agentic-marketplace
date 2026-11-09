import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { callBackend } from "../backend.js";

type AgentCard = {
  slug: string;
  name: string;
  description: string;
  tags: string[];
  keyCapabilities: string[];
  price: string;
  rating: number;
  ratingCount: number;
  totalRuns: number;
  successRate: number | null;
  avgLatencyMs: number | null;
};

type AgentContract = {
  slug: string;
  name: string;
  description: string;
  inputSchema: unknown;
  outputSchema: unknown;
  pricing: unknown;
  priceSummary: string;
  platformFeeRate: number;
  limits: { maxTimeoutSeconds: number | null; maxConcurrent: number | null; rateLimitPerMin: number | null };
};

const fail = (text: string) => ({ isError: true as const, content: [{ type: "text" as const, text }] });

export function registerAgentTools(server: McpServer) {
  server.registerTool(
    "discover_agents",
    {
      description:
        "Search the Catelog marketplace for AI agents that can do a task for the user. " +
        "CALL THIS FIRST whenever the user wants something done that a specialised agent might handle " +
        "(research, lead finding, SEO audits, scraping, data extraction, writing, etc.), or asks " +
        "'what agents exist / is there an agent for X'. Describe the task in plain words in `query`. " +
        "Returns up to `limit` active agents ranked by relevance, each with: slug (the unique id you pass to " +
        "other tools), name, description, tags, key capabilities, price, rating, run count, success rate and average latency. " +
        "It does NOT return input/output schemas. After picking candidates, call `get_agents_schema` with their slugs " +
        "to learn what input they need. Leave `query` empty to browse the top-rated agents. " +
        "Read-only and free: it never runs an agent or spends credits.",
      inputSchema: z.object({
        query: z
          .string()
          .max(200)
          .optional()
          .describe("What the user wants done, in plain words, e.g. 'find B2B leads for a SaaS' or 'SEO audit'. Omit to browse."),
        tag: z
          .string()
          .max(50)
          .optional()
          .describe("Optional exact tag id to narrow results (taken from the `tags` of a previous result)."),
        limit: z.number().int().min(1).max(25).optional().describe("Max agents to return. Default 10."),
      }),
    },
    async ({ query, tag, limit }) => {
      try {
        const agents = await callBackend<AgentCard[]>("/mcp/discover-agents", { query, tag, limit });
        if (agents.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: "No agents matched. Try broader or different keywords, or call again with no query to browse top-rated agents.",
              },
            ],
            structuredContent: { agents: [] },
          };
        }
        const text = agents
          .map(
            (a, i) =>
              `${i + 1}. ${a.name}  [slug: ${a.slug}]\n` +
              `   ${a.description}\n` +
              `   Price: ${a.price} | Rating: ${a.rating.toFixed(1)} (${a.ratingCount}) | Runs: ${a.totalRuns}` +
              `${a.successRate !== null ? ` | Success: ${a.successRate}%` : ""}` +
              `${a.avgLatencyMs !== null ? ` | Avg latency: ${(a.avgLatencyMs / 1000).toFixed(1)}s` : ""}\n` +
              `   Tags: ${a.tags.join(", ") || "none"}` +
              `${a.keyCapabilities.length ? `\n   Can: ${a.keyCapabilities.join("; ")}` : ""}`,
          )
          .join("\n\n");
        return {
          content: [
            {
              type: "text",
              text: `${agents.length} agent(s) found:\n\n${text}\n\nNext: call get_agents_schema with the slug(s) you want to use.`,
            },
          ],
          structuredContent: { agents },
        };
      } catch (e) {
        console.error("discover_agents failed:", e);
        return fail("Could not search the marketplace right now.");
      }
    },
  );

  server.registerTool(
    "get_agents_schema",
    {
      description:
        "Get the exact contract of one or more Catelog agents: the JSON Schema of the INPUT they accept, " +
        "the JSON Schema of the OUTPUT they return, pricing (per run / per unit / tiered), the 12% platform fee, and limits. " +
        "CALL THIS after `discover_agents` and BEFORE running or recommending an agent, so you know which fields are " +
        "required and can ask the user for any missing values or build a valid input yourself. " +
        "Pass the `slug` values from `discover_agents` (up to 5 at once; compare candidates in a single call). " +
        "Never guess an agent's input fields: always read them from here. " +
        "Read-only and free: it never runs an agent or spends credits.",
      inputSchema: z.object({
        slugs: z
          .array(z.string().min(1).max(100))
          .min(1)
          .max(5)
          .describe("Agent slugs exactly as returned by discover_agents, e.g. ['lead-finder']."),
      }),
    },
    async ({ slugs }) => {
      try {
        const r = await callBackend<{ agents: AgentContract[]; notFound: string[] }>("/mcp/agent-schemas", { slugs });
        if (r.agents.length === 0) {
          return fail(
            `No active agent found for: ${r.notFound.join(", ")}. Use discover_agents to get valid slugs.`,
          );
        }
        const text = r.agents
          .map(
            (a) =>
              `## ${a.name}  [slug: ${a.slug}]\n${a.description}\n` +
              `Price: ${a.priceSummary} (+${Math.round(a.platformFeeRate * 100)}% platform fee)\n` +
              `Limits: timeout ${a.limits.maxTimeoutSeconds ?? "n/a"}s, max concurrent ${a.limits.maxConcurrent ?? "n/a"}, ` +
              `rate ${a.limits.rateLimitPerMin ?? "n/a"}/min\n` +
              `Pricing detail: ${JSON.stringify(a.pricing)}\n` +
              `Input JSON Schema:\n${JSON.stringify(a.inputSchema, null, 2)}\n` +
              `Output JSON Schema:\n${JSON.stringify(a.outputSchema, null, 2)}`,
          )
          .join("\n\n---\n\n");
        const missing = r.notFound.length ? `\n\nNot found / inactive: ${r.notFound.join(", ")}` : "";
        return { content: [{ type: "text", text: text + missing }], structuredContent: r };
      } catch (e) {
        console.error("get_agents_schema failed:", e);
        return fail("Could not load agent schemas right now.");
      }
    },
  );
}
