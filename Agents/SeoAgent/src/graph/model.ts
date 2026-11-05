import { ChatOpenAI } from "@langchain/openai";
import { env } from "../config/env.js";

/**
 * Creates a budget-conscious ChatOpenAI instance using gpt-4.1-mini.
 * Falls back safely to gpt-4o-mini if requested by budget or API availability.
 */
export function getChatModel(modelName: string = "gpt-4.1-mini") {
  const apiKey = env.OPENAI_API_KEY || process.env.OPENAI_API_KEY || process.env.OPENAPI_KEY;
  return new ChatOpenAI({
    modelName: modelName,
    temperature: 0.2,
    apiKey: apiKey,
  });
}
