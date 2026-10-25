/**
 * Draft ingestion: PDF / DOCX / Markdown / LaTeX / plain text → normalized draft.
 * Keeps source pointers so scorecard quotes can point back into the user's document.
 */
import { sha256 } from '../lib/util.js';

export interface ParsedDraft {
  text: string;
  kind: 'pdf' | 'docx' | 'md' | 'latex' | 'text';
  chars: number;
  hash: string;
  warnings: string[];
}

export class DraftTooLargeError extends Error {
  constructor(limit: number) {
    super(`Draft exceeds ${limit} characters — shorten it or run sections separately.`);
  }
}

export class UnreadableFileError extends Error {}

const extOf = (name: string): string => (name.split('.').pop() ?? '').toLowerCase();

export async function parseUpload(
  input: { text?: string; buffer?: Buffer; name?: string; mime?: string },
  opts: { maxChars: number; maxBytes: number },
): Promise<ParsedDraft> {
  const warnings: string[] = [];
  let text = '';
  let kind: ParsedDraft['kind'] = 'text';

  if (input.buffer) {
    if (input.buffer.length > opts.maxBytes) {
      throw new UnreadableFileError(`File larger than ${Math.round(opts.maxBytes / 1024 / 1024)} MB.`);
    }
    const ext = extOf(input.name ?? '');
    if (ext === 'pdf' || input.mime === 'application/pdf') {
      kind = 'pdf';
      text = await extractPdf(input.buffer);
      const printable = (text.match(/[A-Za-z0-9]/g) ?? []).length;
      if (text.trim().length < 50 || printable / Math.max(1, text.length) < 0.4) {
        throw new UnreadableFileError(
          'This PDF appears to be image-only (scanned). Paste the text or upload a DOCX instead.',
        );
      }
    } else if (ext === 'docx' || input.mime?.includes('wordprocessingml')) {
      kind = 'docx';
      text = await extractDocx(input.buffer);
    } else if (ext === 'md' || ext === 'markdown') {
      kind = 'md';
      text = input.buffer.toString('utf8');
    } else if (ext === 'tex' || ext === 'latex') {
      kind = 'latex';
      text = input.buffer.toString('utf8');
    } else {
      kind = 'text';
      text = input.buffer.toString('utf8');
    }
  } else if (input.text !== undefined) {
    const t = input.text;
    kind = /^\s*\\documentclass|^\s*\\begin\{document\}/m.test(t)
      ? 'latex'
      : /^#{1,6}\s|\n#{1,6}\s/m.test(t)
        ? 'md'
        : 'text';
    text = t;
  } else {
    throw new UnreadableFileError('No input provided.');
  }

  text = text.replace(/\r\n/g, '\n').trim();
  if (!text) throw new UnreadableFileError('Extracted no readable text from the input.');
  if (text.length > opts.maxChars) throw new DraftTooLargeError(opts.maxChars);

  return { text, kind, chars: text.length, hash: sha256(normalizeForHash(text)), warnings };
}

/** Deterministic hash input: collapse whitespace so trivial edits don't bust the draft cache. */
export const normalizeForHash = (t: string): string => t.replace(/\s+/g, ' ').trim().toLowerCase();

async function extractPdf(buf: Buffer): Promise<string> {
  try {
    // importing the inner module avoids pdf-parse's debug-mode self-run quirk
    const mod = (await import('pdf-parse/lib/pdf-parse.js')) as unknown as {
      default: (b: Buffer) => Promise<{ text: string }>;
    };
    const out = await (mod.default ?? (mod as unknown as (b: Buffer) => Promise<{ text: string }>))(buf);
    return out.text ?? '';
  } catch (e) {
    try {
      const mod = (await import('pdf-parse')) as unknown as { default: (b: Buffer) => Promise<{ text: string }> };
      const out = await mod.default(buf);
      return out.text ?? '';
    } catch {
      throw new UnreadableFileError(`Could not parse PDF: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}

async function extractDocx(buf: Buffer): Promise<string> {
  const mammoth = (await import('mammoth')) as unknown as {
    extractRawText: (i: { buffer: Buffer }) => Promise<{ value: string; messages: unknown[] }>;
  };
  const out = await mammoth.extractRawText({ buffer: buf });
  return out.value ?? '';
}
