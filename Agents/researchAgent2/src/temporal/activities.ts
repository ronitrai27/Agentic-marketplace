import OpenAI from "openai";
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Context } from "@temporalio/activity";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../.env") });
dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

const apiKey = process.env.OPENAI_API_KEY || process.env.OPENAPI_KEY;
const openai = new OpenAI({ apiKey: apiKey || "" });

export interface DeepResearchActivityInput {
  prompt: string;
}

export interface DeepResearchActivityResult {
  answer: string;
  model: string;
  duration_seconds: number;
  taskId: string;
  status: string;
  tokens?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

export async function executeDeepResearchActivity(
  input: DeepResearchActivityInput
): Promise<DeepResearchActivityResult> {
  const activityInfo = Context.current().info;
  console.log(`[DeepResearchActivity] Starting durable deep research task for prompt: "${input.prompt.slice(0, 60)}..." (ActivityId: ${activityInfo.activityId})`);

  const startTime = Date.now();

  let response: any = await openai.responses.create({
    model: "gpt-5.4-mini",
    input: input.prompt,
    background: true,
    reasoning: { effort: "medium" },
    tools: [{ type: "web_search" }],
  });

  const taskId = response.id;
  console.log(`[DeepResearchActivity] Dispatched background task ID: ${taskId}`);

  // Heartbeat & poll loop with Temporal durable timeouts
  while (response.status === "queued" || response.status === "in_progress") {
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    // Send Temporal activity heartbeat so Temporal knows the worker is healthy
    Context.current().heartbeat({
      status: response.status,
      elapsed_seconds: elapsed,
      taskId,
    });

    await new Promise((resolve) => setTimeout(resolve, 2500));
    response = (await openai.responses.retrieve(taskId)) as any;
  }

  if (response.status !== "completed") {
    throw new Error(`OpenAI deep research ended with status: ${response.status}`);
  }

  const duration_seconds = Number(((Date.now() - startTime) / 1000).toFixed(1));
  const usage = response.usage || {};

  return {
    answer: response.output_text || "",
    model: "gpt-5.4-mini",
    duration_seconds,
    taskId,
    status: response.status,
    tokens: {
      prompt_tokens: usage.input_tokens || usage.prompt_tokens,
      completion_tokens: usage.output_tokens || usage.completion_tokens,
      total_tokens: usage.total_tokens,
    },
  };
}
