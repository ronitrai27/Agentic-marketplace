import path from "node:path";
import { extractText, getDocumentProxy } from "unpdf";
import { unzipSync, strFromU8 } from "fflate";

export const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_DOCX_XML_BYTES = 20 * 1024 * 1024;
const MAX_PDF_PAGES = 80;

export class SourceError extends Error {
  readonly code = "INVALID_INPUT";
  readonly retryable = false;
  constructor(message: string) {
    super(message);
    this.name = "SourceError";
  }
}

export interface SourceDoc {
  filename: string;
  /** Plain text extracted from the file. */
  text: string;
  /** Original bytes, kept for future use (e.g. native PDF reading). */
  pdfBytes?: Uint8Array;
}

/** Reads the optional uploaded .pdf/.docx. Pure JS, no OCR. */
export async function readSource(base64: string, filename: string): Promise<SourceDoc> {
  const ext = path.extname(filename).toLowerCase();
  if (ext !== ".pdf" && ext !== ".docx") throw new SourceError("File must be a .pdf or .docx");

  const buf = Buffer.from(base64, "base64");
  if (buf.length === 0) throw new SourceError("The uploaded file is empty");
  if (buf.length > MAX_FILE_BYTES) throw new SourceError("File is larger than 8MB");

  let text: string;
  try {
    text = ext === ".pdf" ? await pdfText(buf) : docxText(buf);
  } catch (err) {
    if (err instanceof SourceError) throw err;
    throw new SourceError(`Could not read the ${ext} file; it may be corrupt or password-protected`);
  }
  text = text.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  if (!text) throw new SourceError("No text found in the file (scanned PDFs are not supported)");

  return { filename, text, pdfBytes: ext === ".pdf" ? new Uint8Array(buf) : undefined };
}

async function pdfText(buf: Buffer): Promise<string> {
  const pdf = await getDocumentProxy(new Uint8Array(buf));
  if (pdf.numPages > MAX_PDF_PAGES) throw new SourceError(`PDF has more than ${MAX_PDF_PAGES} pages`);
  const { text } = await extractText(pdf, { mergePages: true });
  return text;
}

/** DOCX is a zip of XML; reading word/document.xml directly avoids heavy native deps. */
function docxText(buf: Buffer): string {
  const files = unzipSync(new Uint8Array(buf), {
    filter: (f) => {
      if (f.name !== "word/document.xml") return false;
      if (f.originalSize > MAX_DOCX_XML_BYTES) throw new SourceError("Document is too large to process");
      return true;
    },
  });
  const xml = strFromU8(files["word/document.xml"] ?? new Uint8Array());
  return xml
    .replace(/<w:tab\/>/g, "\t")
    .replace(/<w:br[^>]*\/>|<\/w:p>/g, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

/** Splits long text on paragraph boundaries into chunks of at most `size` characters. */
export function chunkText(text: string, size: number): string[] {
  const chunks: string[] = [];
  let cur = "";
  for (const para of text.split(/\n\n+/)) {
    if (cur && cur.length + para.length + 2 > size) {
      chunks.push(cur);
      cur = "";
    }
    if (para.length > size) {
      for (let i = 0; i < para.length; i += size) chunks.push(para.slice(i, i + size));
    } else {
      cur = cur ? `${cur}\n\n${para}` : para;
    }
  }
  if (cur) chunks.push(cur);
  return chunks;
}
