import type { AgentUsage } from "catelog";

const BASE_URL = (process.env.OLLAMA_URL ?? "http://127.0.0.1:11434").replace(/\/$/, "");
export const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? "qwen3.5:4b";
const NUM_CTX = Number(process.env.OLLAMA_NUM_CTX ?? 8192);

export class OllamaError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "OllamaError";
  }
}

interface ChatOptions {
  system: string;
  prompt: string;
  usage: AgentUsage;
  signal?: AbortSignal;
  /** Called with every text chunk as it is generated. */
  onToken?: (text: string) => void;
  maxTokens?: number;
}

/** Streams a chat completion from Ollama and records real model + token usage. */
export async function ollamaChat(opts: ChatOptions): Promise<string> {
  let res: Response;
  try {
    res = await fetch(`${BASE_URL}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: opts.signal,
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        stream: true,
        // Qwen3.x models reason before answering by default: too slow on CPU and eats the token budget.
        think: false,
        messages: [
          { role: "system", content: opts.system },
          { role: "user", content: opts.prompt },
        ],
        options: { num_ctx: NUM_CTX, num_predict: opts.maxTokens ?? 2048, temperature: 0.4 },
      }),
    });
  } catch (err) {
    if (opts.signal?.aborted) throw err;
    throw new OllamaError(`Cannot reach Ollama at ${BASE_URL}`, "UPSTREAM_TIMEOUT", true);
  }
  if (!res.ok || !res.body) {
    const body = await res.text().catch(() => "");
    throw new OllamaError(
      `Ollama returned ${res.status}: ${body.slice(0, 200)}`,
      res.status === 404 ? "INTERNAL_CRASH" : "UPSTREAM_TIMEOUT",
      res.status !== 404,
    );
  }

  let text = "";
  let buffer = "";
  const decoder = new TextDecoder();
  const t0 = Date.now();

  const handle = (line: string): void => {
    if (!line.trim()) return;
    const msg = JSON.parse(line) as {
      message?: { content?: string };
      done?: boolean;
      error?: string;
      model?: string;
      prompt_eval_count?: number;
      eval_count?: number;
    };
    if (msg.error) throw new OllamaError(msg.error, "INTERNAL_CRASH", false);
    const piece = msg.message?.content;
    if (piece) {
      text += piece;
      opts.onToken?.(piece);
    }
    if (msg.done) {
      opts.usage.record({
        model: msg.model ?? OLLAMA_MODEL,
        provider: "ollama",
        tokens: { prompt: msg.prompt_eval_count, completion: msg.eval_count },
        costUsd: 0, // self-hosted: no per-call charge
        latencyMs: Date.now() - t0,
      });
    }
  };

  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(chunk, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) handle(line);
  }
  handle(buffer);
  return text;
}
