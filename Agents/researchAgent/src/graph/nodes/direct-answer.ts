import OpenAI from "openai";
import { ENV } from "../../config/env.js";

const groqClient = new OpenAI({
  apiKey: ENV.GROQ_API_KEY || "build_dummy_key",
  baseURL: "https://api.groq.com/openai/v1",
});

export interface DirectAnswerResult {
  answer: string;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

/**
 * Handles conversational queries, greetings, and trivial direct questions using Groq
 */
export async function generateDirectAnswer(userPrompt: string): Promise<DirectAnswerResult> {
  console.log(`[Groq: ${ENV.GROQ_MODEL}] Generating immediate direct response...`);
  
  const completion = await groqClient.chat.completions.create({
    model: ENV.GROQ_MODEL,
    messages: [
      {
        role: "system",
        content: `You are an intelligent, helpful research assistant. The user has asked a general conversational question or greeting that does not require deep web research. Provide a concise, clear, and engaging response. If relevant, explain that you can conduct in-depth, multi-source deep research if they provide an exploratory topic.`,
      },
      {
        role: "user",
        content: userPrompt,
      },
    ],
    temperature: 0.5,
  });

  const answer = completion.choices[0]?.message?.content || "Hello! I am your Deep Research Agent. How can I assist you with your research today?";
  return {
    answer,
    usage: completion.usage ? {
      prompt_tokens: completion.usage.prompt_tokens,
      completion_tokens: completion.usage.completion_tokens,
      total_tokens: completion.usage.total_tokens,
    } : undefined,
  };
}
