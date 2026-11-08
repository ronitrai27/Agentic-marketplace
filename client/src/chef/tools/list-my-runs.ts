import { z } from "zod";
import { api } from "../../../convex/_generated/api";
import { chefRequest } from "./context";

export const ListMyRunsArgs = z.object({
  // First on purpose: streamed as the "thinking" line, like the other tools.
  plan: z.string().max(240).default("").describe("Write this FIRST. One short sentence: which of the user's runs you are listing (the user reads it)."),
  status: z
    .enum(["succeeded", "failed", "active", "cancelled"])
    .optional()
    .describe('Only runs in this state ("active" = queued or running). Leave out for all runs.'),
  limit: z.number().int().min(1).max(10).default(5).describe("How many of the newest runs to show, 1 to 10 (default 5)."),
});

export type MyRun = {
  id: string;
  agentName: string;
  logoUrl: string | null;
  status: string;
  createdAt: number;
  durationMs: number | null;
  chargedCredits: number | null;
};

export type ListMyRunsResult = { ok: boolean; text: string; runs?: MyRun[] };

/** The list_my_runs tool: the user's own runs, shown as a table the user can open. Never throws. */
export async function listMyRuns(rawArgs: unknown): Promise<ListMyRunsResult> {
  const req = chefRequest.getStore();
  if (!req) return { ok: false, text: "Run history is not available in this context. Tell the user something went wrong and to try again." };

  const parsed = ListMyRunsArgs.safeParse(rawArgs);
  if (!parsed.success) {
    const why = parsed.error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ");
    return { ok: false, text: `The list_my_runs call was invalid (${why}). Call it again with a valid status and a limit of 1 to 10.` };
  }

  try {
    const runs = (await req.convex.query(api.chatRuns.listMine, {
      status: parsed.data.status,
      limit: parsed.data.limit,
    })) as MyRun[];
    if (runs.length === 0) {
      return { ok: true, text: `The user has no ${parsed.data.status ? `${parsed.data.status} ` : ""}runs yet. Tell them plainly and offer to find an agent.`, runs };
    }
    return {
      ok: true,
      runs,
      text:
        `A table of the user's ${runs.length} newest ${parsed.data.status ?? ""} run${runs.length === 1 ? "" : "s"} is now shown to them, ` +
        `with a button to open each output. Do NOT repeat the table. Reply with one short sentence at most. ` +
        `Runs: ${runs.map((r) => `${r.agentName} (${r.status})`).join(", ")}.`,
    };
  } catch (e) {
    console.error("[chef:list_my_runs] failed:", e instanceof Error ? e.message : e);
    return { ok: false, text: "Loading the run history failed because of a temporary error. Tell the user briefly and offer to try again." };
  }
}
