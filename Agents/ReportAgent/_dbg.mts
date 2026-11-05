import "dotenv/config";
import { geminiText, haikuResearch } from "./src/llm/cloud.ts";
import { streamText } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
const usage = { record: (u: any) => console.log("usage", u.provider, u.model, JSON.stringify(u.tokens)) };
const topic = "Topic: Latest developments in solid-state batteries";
const [notes, research] = await Promise.all([
  geminiText({ system: "Research assistant. At most 12 bullets.", prompt: topic, usage, maxTokens: 6000 }),
  haikuResearch({ system: "Search the web, answer with at most 10 bullets.", prompt: topic + "\nUse web search now.", usage, maxTokens: 2000 }),
]);
console.log("notes len", notes.length, "| research len", research.text.length, "searched", research.searched, "sources", research.sources.length);
const r = streamText({ model: anthropic("claude-haiku-5-5"), system: "Write a report of 800-1500 characters. Start with '# Title'.", prompt: `${topic}\nNotes:\n${notes}\nWeb:\n${research.text}`, maxOutputTokens: 700 });
let t = ""; for await (const p of r.textStream) t += p;
console.log("final len", t.length, "finish", await r.finishReason, "raw", await r.rawFinishReason);
