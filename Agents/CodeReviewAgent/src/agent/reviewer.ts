import OpenAI from "openai";
import { ENV } from "../config/env.js";
import { REVIEW_SYSTEM_PROMPT, buildReviewUserPrompt } from "./prompts.js";
import type { ReviewJob, ReviewResult } from "./types.js";

const client = new OpenAI({ apiKey: ENV.OPENAI_API_KEY });

const REVIEW_JSON_SCHEMA = {
  name: "code_review_result",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      summary: { type: "string" },
      score: { type: "integer" },
      verdict: { type: "string", enum: ["approve", "request-changes", "reject"] },
      issues: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            severity: { type: "string", enum: ["critical", "high", "medium", "low", "info"] },
            category: {
              type: "string",
              enum: [
                "security",
                "bug",
                "performance",
                "maintainability",
                "error-handling",
                "readability",
                "best-practice",
                "other",
              ],
            },
            title: { type: "string" },
            description: { type: "string" },
            file: { type: ["string", "null"] },
            line: { type: ["integer", "null"] },
            suggestion: { type: "string" },
            snippet: { type: ["string", "null"] },
          },
          required: [
            "severity",
            "category",
            "title",
            "description",
            "file",
            "line",
            "suggestion",
            "snippet",
          ],
        },
      },
      risks: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            title: { type: "string" },
            description: { type: "string" },
            impact: { type: "string", enum: ["low", "medium", "high"] },
            likelihood: { type: "string", enum: ["low", "medium", "high"] },
          },
          required: ["title", "description", "impact", "likelihood"],
        },
      },
      strengths: { type: "array", items: { type: "string" } },
      recommendations: { type: "array", items: { type: "string" } },
    },
    required: ["summary", "score", "verdict", "issues", "risks", "strengths", "recommendations"],
  },
} as const;

function clampScore(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function normaliseResult(raw: ReviewResult): ReviewResult {
  const issues = [...raw.issues].sort((a, b) => {
    const order: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
    return (order[a.severity] ?? 9) - (order[b.severity] ?? 9);
  });

  return {
    ...raw,
    score: clampScore(raw.score),
    issues,
    risks: raw.risks ?? [],
    strengths: raw.strengths ?? [],
    recommendations: raw.recommendations ?? [],
  };
}

export async function runCodeReview(job: ReviewJob): Promise<ReviewResult> {
  const response = await client.chat.completions.create({
    model: ENV.OPENAI_MODEL,
    temperature: 0.2,
    response_format: {
      type: "json_schema",
      json_schema: REVIEW_JSON_SCHEMA,
    },
    messages: [
      { role: "system", content: REVIEW_SYSTEM_PROMPT },
      { role: "user", content: buildReviewUserPrompt(job) },
    ],
  });

  const message = response.choices[0]?.message;

  if (message?.refusal) {
    throw new Error(`Model refused the review: ${message.refusal}`);
  }

  const content = message?.content;
  if (!content) {
    throw new Error("Model returned an empty response.");
  }

  let parsed: ReviewResult;
  try {
    parsed = JSON.parse(content) as ReviewResult;
  } catch {
    throw new Error("Model returned malformed JSON and could not be parsed.");
  }

  return normaliseResult(parsed);
}
