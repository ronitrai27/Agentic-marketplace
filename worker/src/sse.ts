export interface SseMessage {
  event: string;
  data: unknown;
}

/** Parses a Server-Sent Events body into messages. Bad JSON is passed through as text. */
export async function* readSse(body: ReadableStream<Uint8Array>): AsyncGenerator<SseMessage> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let split: RegExpMatchArray | null;
      while ((split = buffer.match(/\r?\n\r?\n/))) {
        const block = buffer.slice(0, split.index);
        buffer = buffer.slice((split.index ?? 0) + split[0].length);
        const message = parseBlock(block);
        if (message) yield message;
      }
    }
    const tail = parseBlock(buffer);
    if (tail) yield tail;
  } finally {
    reader.releaseLock();
  }
}

function parseBlock(block: string): SseMessage | null {
  let event = "message";
  const data: string[] = [];
  for (const line of block.split(/\r?\n/)) {
    if (line.startsWith(":") || !line) continue;
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
  }
  if (data.length === 0) return null;
  const text = data.join("\n");
  try {
    return { event, data: JSON.parse(text) };
  } catch {
    return { event, data: text };
  }
}
