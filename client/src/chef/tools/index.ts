import { tool } from "@langchain/core/tools";
import { FindAgentsArgs, findAgents, type FindAgentsResult } from "./find-agents";
import { GetAgentDetailsArgs, getAgentDetails } from "./get-agent-details";
import { ProposeRunArgs, proposeRun, type Proposal } from "./propose-run";

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

export const proposeRunTool = tool(async (args) => (await proposeRun(args)).text, {
  name: "propose_run",
  description:
    "Ask the user to approve running 1 or 2 agents. It does NOT run anything: it shows an approval card with each agent's logo, " +
    "the credits that will be held (highest tier for tiered pricing) and the wallet balance, then waits for the user to approve or deny. " +
    "On approval the credits are held and the card shows the agent's input form; Run sends it to the marketplace, which runs it in the background. " +
    "Call it when the user asks to run, use or start an agent they named or picked. Two agents run side by side, independently. " +
    "Never call it for an agent the user has not chosen. Do not describe the card in text.",
  schema: ProposeRunArgs,
});

export const CHEF_TOOLS = [findAgentsTool, getAgentDetailsTool, proposeRunTool];

export type ToolRun = {
  ok: boolean;
  /** Text handed back to the model. */
  text: string;
  /** Present for find_agents, so the UI can render the picker. */
  agents?: FindAgentsResult;
  /** Present for a successful propose_run: the graph pauses for the human's answer. */
  proposal?: Proposal;
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
  if (name === "propose_run") {
    const r = await proposeRun(args);
    return { ok: r.ok, text: r.text, proposal: r.proposal };
  }
  return {
    ok: false,
    text: `There is no tool called "${name}". The tools are find_agents, get_agent_details and propose_run.`,
  };
}
