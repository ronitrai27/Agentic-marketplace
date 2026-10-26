import { query } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { parseResume } from "./parse.js";

export const InputSchema = z.object({
  query: z.string().min(1).describe("What kind of job you want, e.g. 'remote backend roles in Europe'"),
  resumePath: z.string().optional().describe("Optional path to a .pdf or .docx resume"),
});

export const OutputSchema = z.object({
  response: z.string().describe("2-3 sentence answer: what was found and who fits best"),
  jobs: z.array(
    z.object({
      title: z.string(),
      company: z.string(),
      location: z.string(),
      salary: z.string().optional().describe("Only if stated in the posting"),
      url: z.string().describe("Direct link to the posting, taken from search results"),
      match_score: z.number().min(0).max(100),
      match_reason: z.string().describe("One short line tying the job to the resume/query"),
    }),
  ),
});
export type JobFitInput = z.infer<typeof InputSchema>;
export type JobFitOutput = z.infer<typeof OutputSchema>;

const SYSTEM = `You are a job recommendation agent. Find REAL, currently open job postings that fit the user's query and resume.
Rules:
- Use WebSearch to find postings, WebFetch only to verify a promising posting. Do at most ~6 tool calls.
- Return 5 jobs (fewer only if you truly cannot find more). Every url MUST come from a search/fetch result. Never invent jobs, companies, salaries or links.
- match_reason is one short line. response is 2-3 sentences. No filler, no advice, no cover letters.
- Infer skills, seniority and location preference from the resume when provided; the user's query takes priority.`;

export async function runJobFit(
  raw: JobFitInput,
  onStep?: (msg: string) => void,
): Promise<{ output: JobFitOutput; costUsd: number }> {
  const input = InputSchema.parse(raw);
  let resume = "";
  if (input.resumePath) {
    onStep?.("Parsing resume...");
    resume = await parseResume(input.resumePath);
  }

  const prompt = `Query: ${input.query}\n\n${resume ? `Resume:\n"""\n${resume}\n"""` : "(no resume provided)"}`;

  const stream = query({
    prompt,
    options: {
      model: process.env.JOBFIT_MODEL ?? "claude-haiku-5-5",
      systemPrompt: SYSTEM,
      tools: ["WebSearch", "WebFetch"],
      allowedTools: ["WebSearch", "WebFetch"],
      permissionMode: "dontAsk",
      settingSources: [],
      persistSession: false,
      maxTurns: 12,
      maxBudgetUsd: Number(process.env.JOBFIT_MAX_BUDGET_USD ?? 0.15),
      outputFormat: { type: "json_schema", schema: z.toJSONSchema(OutputSchema) as Record<string, unknown> },
    },
  });

  for await (const msg of stream) {
    if (msg.type === "assistant") {
      for (const block of msg.message.content) {
        if (block.type === "tool_use") onStep?.(`${block.name}: ${JSON.stringify(block.input).slice(0, 100)}`);
      }
    } else if (msg.type === "result") {
      if (msg.subtype !== "success" || !msg.structured_output) {
        throw new Error(`Agent failed (${msg.subtype})`);
      }
      return { output: OutputSchema.parse(msg.structured_output), costUsd: msg.total_cost_usd };
    }
  }
  throw new Error("Agent ended without a result");
}
