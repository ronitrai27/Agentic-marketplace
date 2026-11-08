import { z } from "zod";
import { api } from "../../../convex/_generated/api";
import { chefRequest } from "./context";

export const GetRunResultsArgs = z.object({
  // First on purpose: streamed as the "thinking" line, like the other tools.
  plan: z.string().max(240).default("").describe("Write this FIRST. One short sentence: which run's results you are reading (the user reads it)."),
  runId: z
    .string()
    .max(64)
    .optional()
    .describe("The run id from the run note or list_my_runs. Leave out to read the newest finished run of this chat."),
});

export type GetRunResultsResult = { ok: boolean; text: string };

const OUTPUT_FOR_MODEL = 3000;

/** The get_run_results tool: status, time, cost, input and the (truncated) output of one run. Never throws. */
export async function getRunResults(rawArgs: unknown): Promise<GetRunResultsResult> {
  const req = chefRequest.getStore();
  if (!req?.chatId) return { ok: false, text: "Run results are not available in this context. Tell the user something went wrong and to try again." };

  const parsed = GetRunResultsArgs.safeParse(rawArgs);
  if (!parsed.success) return { ok: false, text: "The get_run_results call was invalid. Call it again with a run id, or none for the newest finished run." };

  try {
    const r = await req.convex.query(api.chatRuns.runResult, { chatId: req.chatId, runId: parsed.data.runId });
    if (!r) return { ok: false, text: "No such finished run was found for this user. Say so plainly; do not guess." };

    const secs = r.durationMs !== null ? `${(r.durationMs / 1000).toFixed(1)}s` : "unknown";
    const out = r.outputJson;
    const clipped = out && out.length > OUTPUT_FOR_MODEL ? `${out.slice(0, OUTPUT_FOR_MODEL)}…` : out;
    return {
      ok: true,
      text: [
        `RUN ${r.id}: ${r.agentName}`,
        `Status: ${r.status}${r.error ? ` (${r.error.code}: ${r.error.message})` : ""}`,
        `Took: ${secs}`,
        `Credits: held ${r.holdCredits ?? "n/a"}, charged ${r.chargedCredits ?? "n/a"}`,
        `Schema check: ${r.schemaCheckJson ?? "not recorded"}`,
        `Token usage: not tracked by the marketplace`,
        `Input given: ${r.inputJson ?? "(too large to show)"}`,
        clipped
          ? `Output (${r.outputChars} chars${r.outputChars > OUTPUT_FOR_MODEL ? `, truncated to the first ${OUTPUT_FOR_MODEL}; the user can open the full output with the Open output button` : ""}):\n${clipped}`
          : "Output: none stored.",
      ].join("\n"),
    };
  } catch (e) {
    console.error("[chef:get_run_results] failed:", e instanceof Error ? e.message : e);
    return { ok: false, text: "Reading the run failed because of a temporary error. Tell the user briefly and offer to try again." };
  }
}
