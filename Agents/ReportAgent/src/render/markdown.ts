/** Tiny markdown reader for what the writer prompt produces: headings, bullets, numbered items, bold/italic. */

export interface Run {
  text: string;
  bold?: boolean;
  italic?: boolean;
}

export type Block =
  | { type: "h1" | "h2" | "h3" | "p" | "li" | "oli"; runs: Run[] };

export function parseInline(src: string): Run[] {
  const runs: Run[] = [];
  const re = /(\*\*[^*]+\*\*|\*[^*\s][^*]*\*|_[^_\s][^_]*_)/g;
  let last = 0;
  for (const m of src.matchAll(re)) {
    if (m.index > last) runs.push({ text: src.slice(last, m.index) });
    const tok = m[0];
    if (tok.startsWith("**")) runs.push({ text: tok.slice(2, -2), bold: true });
    else runs.push({ text: tok.slice(1, -1), italic: true });
    last = m.index + tok.length;
  }
  if (last < src.length) runs.push({ text: src.slice(last) });
  return runs.length ? runs : [{ text: src }];
}

export function parseMarkdown(md: string): Block[] {
  const blocks: Block[] = [];
  let para: string[] = [];
  const flush = (): void => {
    if (para.length) blocks.push({ type: "p", runs: parseInline(para.join(" ")) });
    para = [];
  };

  for (const raw of md.replace(/\r/g, "").split("\n")) {
    const line = raw.trim();
    if (!line) {
      flush();
      continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      flush();
      const level = Math.min(h[1].length, 3);
      blocks.push({ type: `h${level}` as "h1" | "h2" | "h3", runs: parseInline(h[2]) });
      continue;
    }
    const li = /^[-*•]\s+(.*)$/.exec(line);
    if (li) {
      flush();
      blocks.push({ type: "li", runs: parseInline(li[1]) });
      continue;
    }
    const oli = /^\d+[.)]\s+(.*)$/.exec(line);
    if (oli) {
      flush();
      blocks.push({ type: "oli", runs: parseInline(oli[1]) });
      continue;
    }
    para.push(line);
  }
  flush();
  return blocks;
}

/** Title for the file name and cover: first H1, else the fallback. */
export function titleOf(md: string, fallback: string): string {
  const m = /^#\s+(.+)$/m.exec(md);
  return (m?.[1] ?? fallback).replace(/[*_`]/g, "").trim().slice(0, 120) || fallback;
}

export function wordCount(md: string): number {
  return md.replace(/[#*_`>-]/g, " ").split(/\s+/).filter(Boolean).length;
}

/**
 * Enforces the character budget. Cuts at a paragraph break when one leaves a reasonable report,
 * otherwise at a sentence end, so a report never ends mid-word.
 */
export function fitLength(md: string, max: number, min: number): string {
  const text = md.trim();
  if (text.length <= max) return text;
  const head = text.slice(0, max);
  const para = head.lastIndexOf("\n\n");
  if (para >= min) return head.slice(0, para).trim();
  const sentence = Math.max(head.lastIndexOf(". "), head.lastIndexOf(".\n"));
  if (sentence >= min) return head.slice(0, sentence + 1).trim();
  return head.trim();
}
