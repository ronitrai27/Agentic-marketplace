import { tool } from "@langchain/core/tools";
import { FindAgentsArgs, findAgents, type FindAgentsResult } from "./find-agents";
import { GetAgentDetailsArgs, getAgentDetails } from "./get-agent-details";

/** Declared to the model. The node runs tools itself (so it can stream their progress), via `runTool`. */
export const findAgentsTool = tool(async (args) => (await findAgents(args)).text, {
  name: "find_agents",
  description:
    "Find agents in the Catelog marketplace. Use mode \"task\" with the user's task: it returns only the agents whose description and tags " +
    "say they are built for that task, best fit first (ties broken by reviews, reliability and speed); it may return just one. " +
    "Use mode \"name\" only when the user gives a specific agent name, even approximately (\"Nova research\"): it returns the exact match and similarly named agents. A description like \"best research agent\" is a task, not a name. " +
    "The user sees the result as selectable cards, so do not repeat the list. Never invent agent names: only agents this tool returns exist.",
  schema: FindAgentsArgs,
});

export const getAgentDetailsTool = tool(async (args) => (await getAgentDetails(args)).text, {
  name: "get_agent_details",
  description:
    "Get the full details of 1 to 3 agents by name: description, capabilities, tags, models, price, input and output schema, " +
    "run stats, rating with star breakdown, and the newest reviews. Use it when the user asks about an agent (details, how it works, " +
    "what it needs as input, reviews, stats) or wants to compare agents. Pass names exactly as the user or find_agents gave them. " +
    "Present the result as a markdown table.",
  schema: GetAgentDetailsArgs,
});

export const CHEF_TOOLS = [findAgentsTool, getAgentDetailsTool];

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
  if (name === "get_agent_details") {
    const r = await getAgentDetails(args);
    return { ok: r.ok, text: r.text };
  }
  return {
    ok: false,
    text: `There is no tool called "${name}". The tools are find_agents and get_agent_details.`,
  };
}
