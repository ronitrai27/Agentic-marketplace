import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildDocx } from "./render/docx.js";
import { buildPdf } from "./render/pdf.js";
import type { ReportOutput } from "./schema.js";

type OutFile = ReportOutput["files"][number];

const MIME = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
} as const;

/** Inline delivery limit while there is no file storage; bigger files are written to disk only. */
const MAX_INLINE_BYTES = 1_500_000;

export function safeFilename(title: string, ext: string): string {
  const base = title
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .toLowerCase()
    .slice(0, 60);
  return `${base || "report"}.${ext}`;
}

export async function renderFile(
  format: "pdf" | "docx",
  markdown: string,
  title: string,
): Promise<{ buffer: Buffer; filename: string; mime: string }> {
  const buffer = format === "pdf" ? await buildPdf(markdown, title) : await buildDocx(markdown, title);
  return { buffer, filename: safeFilename(title, format), mime: MIME[format] };
}

/**
 * The single place files leave this agent. Today: write to ./out and return the bytes inline.
 * When marketplace storage (R2) ships, replace the body with `ctx.files.save(...)` and drop `data_base64`.
 */
export async function deliverFile(
  file: { buffer: Buffer; filename: string; mime: string },
  runId: string,
): Promise<OutFile> {
  const dir = path.join(process.cwd(), "out", runId.replace(/[^\w-]/g, ""));
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, file.filename), file.buffer);

  return {
    filename: file.filename,
    mime: file.mime,
    bytes: file.buffer.length,
    data_base64: file.buffer.length <= MAX_INLINE_BYTES ? file.buffer.toString("base64") : undefined,
  };
}
