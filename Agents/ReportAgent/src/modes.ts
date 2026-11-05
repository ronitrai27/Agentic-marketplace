import type { AgentStream, AgentUsage } from "catelog";
import { chunkText, type SourceDoc } from "./source.js";
import { ollamaChat } from "./llm/ollama.js";
import { groqText, haikuResearch, haikuText } from "./llm/cloud.js";

export interface RunCtx {
  topic: string;
  source?: SourceDoc;
  usage: AgentUsage;
  stream: AgentStream;
  signal: AbortSignal;
}

export interface ModeResult {
  markdown: string;
  sources: string[];
}

/** Hard output budget for the finished report text. */
export const MIN_CHARS = 800;
export const MAX_CHARS = 1500;

const todayLine = (): string => {
  const now = new Date();
  const date = now.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  return `Today's date is ${date} (${now.toISOString().slice(0, 10)}). The current year is ${now.getFullYear()}.`;
};

const LENGTH_RULE = `LENGTH: the finished report must be between ${MIN_CHARS} and ${MAX_CHARS} characters in total, about 130-220 words. Never exceed ${MAX_CHARS} characters.`;

const FORMAT_RULES = `Output GitHub-flavoured markdown only. Start with a single "# Title" line, then 2-4 short sections with "## " headings. Use short paragraphs, "- " bullets and **bold** where helpful. No tables, no code fences, no preamble.`;

const writerSystem = (): string =>
  `${todayLine()}\nYou are a careful report writer. Write clear, factual, well-structured reports. Never invent statistics, quotes or sources: if something is not in the provided material and you are not sure of it, leave it out.\n${FORMAT_RULES}\n${LENGTH_RULE}`;

const subject = (c: RunCtx): string => `Topic: ${c.topic}`;

// ─────────────────────────────────────────────────
//  instant: one small local model (Ollama)
// ─────────────────────────────────────────────────

const MAX_DIRECT_CHARS = 10_000;
const CHUNK_CHARS = 6_000;
const MAX_CHUNKS = 8;

export async function runInstant(c: RunCtx): Promise<ModeResult> {
  let material = "";

  if (c.source) {
    if (c.source.text.length <= MAX_DIRECT_CHARS) {
      material = c.source.text;
    } else {
      // Small local models have short context: condense each part first, then write from the notes.
      const chunks = chunkText(c.source.text, CHUNK_CHARS).slice(0, MAX_CHUNKS);
      const notes: string[] = [];
      for (const [i, chunk] of chunks.entries()) {
        c.stream.progress(10 + Math.round((i / chunks.length) * 40), `Reading part ${i + 1} of ${chunks.length}`);
        notes.push(
          await ollamaChat({
            system: "Extract the key facts, figures and arguments from this text as concise bullet points. No commentary.",
            prompt: chunk,
            usage: c.usage,
            signal: c.signal,
            maxTokens: 300,
          }),
        );
      }
      material = notes.join("\n\n");
    }
  }

  c.stream.progress(55, "Writing the report");
  const markdown = await ollamaChat({
    system: writerSystem(),
    prompt: [subject(c), material ? `\nSource material:\n"""\n${material}\n"""` : "", `\nWrite the report now. ${LENGTH_RULE}`].join("\n"),
    usage: c.usage,
    signal: c.signal,
    maxTokens: 1000,
    onToken: (t) => c.stream.delta(t),
  });
  return { markdown, sources: [] };
}

// ─────────────────────────────────────────────────
//  detailed: Groq (gpt-oss-120b) + Claude Haiku (web search)
// ─────────────────────────────────────────────────

/** Keeps the document inside Groq's per-minute token limit. */
const MAX_GROQ_DOC_CHARS = Number(process.env.REPORT_GROQ_DOC_CHARS ?? 16_000);

export async function runDetailed(c: RunCtx): Promise<ModeResult> {
  c.stream.progress(10, "Groq is reading the material while Claude searches the web");

  // Stage 1, in parallel: Groq digests the document / topic, Claude researches current facts online.
  const [notes, research] = await Promise.all([
    groqText({
      system: `${todayLine()}\nYou are a research assistant. Produce accurate research notes as at most 12 bullet points: key facts, figures, definitions and arguments. Only include things you are confident are true or that appear in the provided document. No introduction.`,
      prompt: [
        subject(c),
        c.source ? `
Document text:
"""
${c.source.text.slice(0, MAX_GROQ_DOC_CHARS)}
"""` : "",
      ].join("\n"),
      usage: c.usage,
      signal: c.signal,
      maxTokens: 4000, // gpt-oss reasons first; that counts against this budget
    }),
    haikuResearch({
      system: `${todayLine()}\nYou research topics using web search. Search the web for the most current and relevant facts (prefer ${new Date().getFullYear()} information when it exists), then answer with at most 10 bullet points, each with the date or year it refers to. No introduction.`,
      prompt: `${subject(c)}\nUse web search now, then give the bullets.`,
      usage: c.usage,
      signal: c.signal,
      maxTokens: 2000,
    }),
  ]);

  // Stage 2: Claude writes the final report from both sets of notes.
  c.stream.progress(55, "Claude is writing the report");
  const markdown = await haikuText({
    system: writerSystem(),
    prompt: [
      subject(c),
      `\nNotes from the provided material and background knowledge:\n${notes}`,
      `\nCurrent facts from the web${research.searched ? "" : " (web search unavailable)"}:\n${research.text}`,
      `\nWrite the final report now, combining both. Prefer the more recent facts when they conflict. ${LENGTH_RULE}`,
    ].join("\n"),
    usage: c.usage,
    signal: c.signal,
    maxTokens: 1000,
    onToken: (t) => c.stream.delta(t),
  });
  return { markdown, sources: research.sources };
}
