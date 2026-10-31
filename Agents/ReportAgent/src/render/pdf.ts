import PDFDocument from "pdfkit";
import { parseMarkdown, type Run } from "./markdown.js";

const MARGIN = 64;

/** Built-in PDF fonts only cover Latin-1/WinAnsi. Map common typography, replace the rest. */
function clean(s: string): string {
  return s
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/ /g, " ")
    .replace(/[^\x09\x0A\x20-\x7E¡-ÿ•]/g, "?");
}

function font(r: Run): string {
  if (r.bold && r.italic) return "Helvetica-BoldOblique";
  if (r.bold) return "Helvetica-Bold";
  if (r.italic) return "Helvetica-Oblique";
  return "Helvetica";
}

export function buildPdf(markdown: string, title: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
      info: { Title: clean(title), Creator: "Catelog Report Agent" },
    });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const runs = (rs: Run[], size: number, opts: PDFKit.Mixins.TextOptions = {}): void => {
      rs.forEach((r, i) => {
        doc.font(font(r)).fontSize(size).text(clean(r.text), { ...opts, continued: i < rs.length - 1 });
      });
    };

    let ordinal = 0;
    for (const b of parseMarkdown(markdown)) {
      if (b.type !== "oli") ordinal = 0;
      switch (b.type) {
        case "h1":
          doc.moveDown(0.3);
          runs(b.runs.map((r) => ({ ...r, bold: true })), 22);
          doc.moveDown(0.6);
          break;
        case "h2":
          doc.moveDown(0.8);
          runs(b.runs.map((r) => ({ ...r, bold: true })), 15);
          doc.moveDown(0.3);
          break;
        case "h3":
          doc.moveDown(0.5);
          runs(b.runs.map((r) => ({ ...r, bold: true })), 12.5);
          doc.moveDown(0.2);
          break;
        case "li":
          runs([{ text: "•  " }, ...b.runs], 11, { indent: 12, lineGap: 2 });
          doc.moveDown(0.25);
          break;
        case "oli":
          ordinal += 1;
          runs([{ text: `${ordinal}.  ` }, ...b.runs], 11, { indent: 12, lineGap: 2 });
          doc.moveDown(0.25);
          break;
        default:
          runs(b.runs, 11, { lineGap: 3, align: "left" });
          doc.moveDown(0.7);
      }
    }
    doc.end();
  });
}
