import { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api";

export type OutMessage = {
  messageId: string;
  role: "user" | "assistant";
  kind: "text" | "refusal";
  text: string;
  /** Time the chef took to answer, stored with the reply. */
  durationMs?: number;
  createdAt: number;
};

const RETRIES = 3;

/**
 * Background writer of chat messages to Convex. `push` is synchronous and returns immediately; the write is
 * batched on the next tick and never awaited by the chat flow. Postgres holds the truth, Convex is the UI copy,
 * so a failed write is retried and logged but never breaks a turn. Writes for one chat run in order.
 */
export class ChatOutbox {
  private queue: OutMessage[] = [];
  private scheduled = false;
  private chain: Promise<void> = Promise.resolve();
  private ord = 0;

  constructor(
    private readonly client: ConvexHttpClient,
    private readonly chatId: string,
    private readonly title: string,
  ) {}

  push(msg: OutMessage) {
    this.queue.push(msg);
    if (this.scheduled) return;
    this.scheduled = true;
    setTimeout(() => {
      this.scheduled = false;
      const batch = this.queue.splice(0);
      if (batch.length) this.chain = this.chain.then(() => this.send(batch));
    }, 0);
  }

  /** Resolves when everything pushed so far has been written (use with Next's `after`, never in the chat path). */
  idle() {
    return this.chain;
  }

  private async send(batch: OutMessage[]) {
    const started = Date.now();
    const messages = batch.map((m) => ({ ...m, ord: this.ord++ }));
    for (let attempt = 1; attempt <= RETRIES; attempt++) {
      try {
        const { stored } = await this.client.mutation(api.chat.appendBatch, {
          chatId: this.chatId,
          title: this.title,
          messages,
        });
        console.log(
          `[chef:outbox] chat=${this.chatId} saved to convex: ${stored}/${messages.length} message(s) ` +
            `[${messages.map((m) => `${m.role}:${m.kind}`).join(", ")}] ms=${Date.now() - started}`,
        );
        return;
      } catch (e) {
        console.error(`[chef:outbox] chat=${this.chatId} attempt ${attempt}/${RETRIES} failed:`, e instanceof Error ? e.message : e);
        if (attempt < RETRIES) await new Promise((r) => setTimeout(r, 300 * 2 ** attempt));
      }
    }
    console.error(`[chef:outbox] chat=${this.chatId} gave up on ${messages.length} message(s); Postgres checkpoint still has them`);
  }
}
