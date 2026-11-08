import { z } from "zod";
import { api } from "../../../convex/_generated/api";
import { chefRequest } from "./context";
import { lookupByName } from "./find-agents";

/** What the model may pass: 1 or 2 agents to run. Two run side by side, independently, never chained. */
export const ProposeRunArgs = z.object({
  // First on purpose: streamed as the "thinking" line, like the other tools.
  plan: z
    .string()
    .max(240)
    .default("")
    .describe("Write this FIRST. One short sentence: which agent(s) you are asking the user to run and why (the user reads it)."),
  names: z
    .array(z.string().trim().min(1).max(80))
    .min(1, "give at least one agent name")
    .max(2, "at most 2 agents at a time")
    .describe('Agent names to run, 1 or 2 (e.g. ["Nova Research"]). Names exactly as the user or find_agents gave them.'),
});

export type Proposal = {
  proposalId: string;
  agents: { name: string; holdCredits: number; tiered: boolean }[];
  totalCredits: number;
  available: number;
  enough: boolean;
  expiresAt: number;
};

export type ProposeRunResult = { ok: boolean; text: string; proposal?: Proposal };

const fail = (text: string): ProposeRunResult => ({ ok: false, text });

/**
 * The propose_run tool. It never runs, holds or charges anything: it resolves the agents, has Convex price them
 * (highest tier for tiered plans) against the wallet, and stores an approval card. The graph then pauses (HITL)
 * until the human approves or denies. Never throws.
 */
export async function proposeRun(rawArgs: unknown): Promise<ProposeRunResult> {
  const req = chefRequest.getStore();
  if (!req?.chatId) return fail("Running agents is not available in this context. Tell the user something went wrong and to try again.");

  const parsed = ProposeRunArgs.safeParse(rawArgs);
  if (!parsed.success) {
    const why = parsed.error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ");
    return fail(`The propose_run call was invalid (${why}). Call it again with 1 or 2 agent names.`);
  }
  const names = [...new Set(parsed.data.names)];

  try {
    const looked = await Promise.all(names.map(async (n) => ({ ref: n, ...(await lookupByName(req, n)) })));
    const ids: string[] = [];
    const notes: string[] = [];
    for (const l of looked) {
      if (l.match) {
        if (!ids.includes(l.match.id)) ids.push(l.match.id);
      } else if (l.options.length) {
        notes.push(`"${l.ref}" is ambiguous; ask whether they mean ${l.options.map((o) => `"${o}"`).join(" or ")}.`);
      } else {
        notes.push(`No agent is named "${l.ref}". Do not guess; offer to search with find_agents.`);
      }
    }
    // Run all or nothing: a half-resolved pair is asked about first
    if (notes.length || ids.length === 0) return fail(`Nothing was proposed.\n${notes.join("\n")}`);

    const proposalId = crypto.randomUUID();
    const res = await req.convex.mutation(api.chatRuns.propose, { chatId: req.chatId, proposalId, agentIds: ids });
    if (!res.ok) return fail(`Nothing was proposed. ${res.problems.join(" ")} Tell the user plainly.`);

    const proposal: Proposal = {
      proposalId,
      agents: res.agents,
      totalCredits: res.totalCredits,
      available: res.available,
      enough: res.enough,
      expiresAt: res.expiresAt,
    };
    const list = res.agents.map((a) => `${a.name} (holds ${a.holdCredits} credits${a.tiered ? ", highest tier" : ""})`).join(", ");
    return {
      ok: true,
      proposal,
      text:
        `Approval card shown for ${list}; total hold ${res.totalCredits} credits, wallet has ${res.available}.` +
        (res.problems.length ? ` Note: ${res.problems.join(" ")}` : "") +
        " Waiting for the user to approve or deny.",
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[chef:propose_run] failed:", msg);
    if (msg === "SEARCH_NOT_CONFIGURED") return fail("Agent lookup is not configured on the server. Tell the user running is unavailable right now.");
    return fail("Preparing the run failed because of a temporary error. Tell the user briefly and offer to try again.");
  }
}
