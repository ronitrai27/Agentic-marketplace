import { anthropic } from "@ai-sdk/anthropic";
import { openai } from "@ai-sdk/openai";

// Cheap models only.
export const haiku = () => anthropic(process.env.HAIKU_MODEL || "claude-haiku-5-5");
export const mini = () => openai(process.env.MINI_MODEL || "gpt-4.1-mini");
