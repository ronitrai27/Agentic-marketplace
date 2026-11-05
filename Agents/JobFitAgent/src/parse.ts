import { readFile } from "node:fs/promises";
import path from "node:path";
import { extractText, getDocumentProxy } from "unpdf";
import { unzipSync, strFromU8 } from "fflate";

export const MAX_RESUME_BYTES = 5 * 1024 * 1024;
const MAX_CHARS = 12_000;
/** Guards against decompression bombs / absurd files: real resumes are far below these. */
const MAX_DOCX_XML_BYTES = 10 * 1024 * 1024;
const MAX_PDF_PAGES = 40;

export class ResumeError extends Error {
  readonly code = "INVALID_INPUT";
  readonly retryable = false;
  constructor(message: string) {
    super(message);
    this.name = "ResumeError";
  }
}

/** Free, local parsing (unpdf for PDF, fflate for DOCX). OCR only for scanned PDFs when OCR_SPACE_API_KEY is set. */
export async function parseResume(buf: Buffer, filename: string): Promise<string> {
  const ext = path.extname(filename).toLowerCase();
  if (ext !== ".pdf" && ext !== ".docx") throw new ResumeError("Resume must be a .pdf or .docx file");
  if (buf.length > MAX_RESUME_BYTES) throw new ResumeError("Resume file is larger than 5MB");

  let text: string;
  try {
    text = ext === ".pdf" ? await pdfText(buf) : docxText(buf);
  } catch (err) {
    if (err instanceof ResumeError) throw err;
    throw new ResumeError(`Could not read the ${ext} file; it may be corrupt or password-protected`);
  }
  text = text.replace(/\s+\n/g, "\n").replace(/[ \t]+/g, " ").trim();

  if (!text && ext === ".pdf") text = await ocrSpace(buf, filename);
  if (!text) throw new ResumeError("Could not extract any text from the resume");
  return text.slice(0, MAX_CHARS);
}

export async function parseResumeFile(filePath: string): Promise<string> {
  return parseResume(await readFile(filePath), path.basename(filePath));
}

/**
 * DOCX is a zip of XML. Reading word/document.xml directly keeps this pure JS (no `fs`),
 * so it also survives serverless bundlers that break CommonJS packages like mammoth.
 */
function docxText(buf: Buffer): string {
  const files = unzipSync(new Uint8Array(buf), {
    filter: (f) => {
      if (f.name !== "word/document.xml") return false;
      if (f.originalSize > MAX_DOCX_XML_BYTES) throw new ResumeError("Resume content is too large to process");
      return true;
    },
  });
  const xml = strFromU8(files["word/document.xml"] ?? new Uint8Array());
  return xml
    .replace(/<w:tab\/>/g, "\t")
    .replace(/<w:br[^>]*\/>|<\/w:p>/g, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

async function pdfText(buf: Buffer): Promise<string> {
  const pdf = await getDocumentProxy(new Uint8Array(buf));
  if (pdf.numPages > MAX_PDF_PAGES) throw new ResumeError(`Resume has too many pages (max ${MAX_PDF_PAGES})`);
  const { text } = await extractText(pdf, { mergePages: true });
  return text;
}

async function ocrSpace(buf: Buffer, name: string): Promise<string> {
  const key = process.env.OCR_SPACE_API_KEY;
  if (!key) {
    throw new ResumeError("Scanned PDF detected. Upload a text-based PDF/DOCX (OCR is not enabled on this agent)");
  }
  const form = new FormData();
  form.set("isOverlayRequired", "false");
  form.set("OCREngine", "2");
  form.set("file", new Blob([new Uint8Array(buf)], { type: "application/pdf" }), name);
  const res = await fetch("https://api.ocr.space/parse/image", { method: "POST", headers: { apikey: key }, body: form });
  const json: any = await res.json();
  if (json.IsErroredOnProcessing) {
    throw Object.assign(new Error(`OCR failed: ${[].concat(json.ErrorMessage).join("; ")}`), {
      code: "TOOL_FAILURE",
      retryable: true,
    });
  }
  return (json.ParsedResults ?? []).map((r: any) => r.ParsedText).join("\n");
}
