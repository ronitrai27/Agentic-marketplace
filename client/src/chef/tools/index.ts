import { tool } from "@langchain/core/tools";
import { FindAgentsArgs, findAgents, type FindAgentsResult } from "./find-agents";

/** Declared to the model. The node runs tools itself (so it can stream their progress), via `runTool`. */
export const findAgentsTool = tool(async (args) => (await findAgents(args)).text, {
  name: "find_agents",
  description:
    "Find agents in the Catelog marketplace. Use mode \"task\" with the user's task to get the best 5-6 agents ranked by relevance, reviews, reliability and speed. " +
    "Use mode \"name\" only when the user gives a specific agent name, even approximately (\"Nova research\"): it returns the exact match and similarly named agents. A description like \"best research agent\" is a task, not a name. " +
    "The user sees the result as selectable cards, so do not repeat the list. Never invent agent names: only agents this tool returns exist.",
  schema: FindAgentsArgs,
});

export const CHEF_TOOLS = [findAgentsTool];

export type ToolRun = {
  ok: boolean;
  /** Text handed back to the model. */
  text: string;
  /** Present for find_agents, so the UI can render the picker. */
  agents?: FindAgentsResult;
};

/** Run one tool call by name. Unknown tools and bad arguments come back as text, never as exceptions. */
export async function runTool(name: string, args: unknown): Promise<ToolRun> {
  if (name === "find_agents") {
    const r = await findAgents(args);
    return { ok: r.ok, text: r.text, agents: r };
  }
  return {
    ok: false,
    text: `There is no tool called "${name}". The only tool is find_agents. Answer without it or call find_agents.`,
  };
}
