import { readFile } from "node:fs/promises";
import path from "node:path";
import { extractText, getDocumentProxy } from "unpdf";
import mammoth from "mammoth";

const MAX_BYTES = 5 * 1024 * 1024;
const MAX_CHARS = 12_000;

/** Free, local parsing (unpdf for PDF, mammoth for DOCX). OCR only if a scanned PDF and OCR_SPACE_API_KEY is set. */
export async function parseResume(filePath: string): Promise<string> {
  const ext = path.extname(filePath).toLowerCase();
  if (ext !== ".pdf" && ext !== ".docx") {
    throw new Error("Resume must be a .pdf or .docx file");
  }
  const buf = await readFile(filePath);
  if (buf.length > MAX_BYTES) throw new Error("Resume file is larger than 5MB");

  let text = ext === ".pdf" ? await pdfText(buf) : (await mammoth.extractRawText({ buffer: buf })).value;
  text = text.replace(/\s+\n/g, "\n").replace(/[ \t]+/g, " ").trim();

  if (!text && ext === ".pdf") text = await ocrSpace(buf, path.basename(filePath));
  if (!text) throw new Error("Could not extract any text from the resume");
  return text.slice(0, MAX_CHARS);
}

async function pdfText(buf: Buffer): Promise<string> {
  const pdf = await getDocumentProxy(new Uint8Array(buf));
  const { text } = await extractText(pdf, { mergePages: true });
  return text;
}

async function ocrSpace(buf: Buffer, name: string): Promise<string> {
  const key = process.env.OCR_SPACE_API_KEY;
  if (!key) {
    throw new Error("Scanned PDF detected. Set OCR_SPACE_API_KEY to enable OCR, or upload a text-based PDF/DOCX");
  }
  const form = new FormData();
  form.set("isOverlayRequired", "false");
  form.set("OCREngine", "2");
  form.set("file", new Blob([new Uint8Array(buf)], { type: "application/pdf" }), name);
  const res = await fetch("https://api.ocr.space/parse/image", { method: "POST", headers: { apikey: key }, body: form });
  const json: any = await res.json();
  if (json.IsErroredOnProcessing) throw new Error(`OCR failed: ${[].concat(json.ErrorMessage).join("; ")}`);
  return (json.ParsedResults ?? []).map((r: any) => r.ParsedText).join("\n");
}
