import { Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx";
import { parseMarkdown, type Run } from "./markdown.js";

const toRuns = (rs: Run[], extra: { bold?: boolean } = {}): TextRun[] =>
  rs.map((r) => new TextRun({ text: r.text, bold: r.bold || extra.bold, italics: r.italic }));

export async function buildDocx(markdown: string, title: string): Promise<Buffer> {
  const children: Paragraph[] = [];
  let numbered = 0;

  for (const b of parseMarkdown(markdown)) {
    if (b.type !== "oli") numbered = 0;
    switch (b.type) {
      case "h1":
        children.push(new Paragraph({ heading: HeadingLevel.TITLE, children: toRuns(b.runs) }));
        break;
      case "h2":
        children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: toRuns(b.runs) }));
        break;
      case "h3":
        children.push(new Paragraph({ heading: HeadingLevel.HEADING_2, children: toRuns(b.runs) }));
        break;
      case "li":
        children.push(new Paragraph({ bullet: { level: 0 }, children: toRuns(b.runs) }));
        break;
      case "oli":
        numbered += 1;
        children.push(
          new Paragraph({ indent: { left: 360 }, children: [new TextRun(`${numbered}.  `), ...toRuns(b.runs)] }),
        );
        break;
      default:
        children.push(new Paragraph({ spacing: { after: 160 }, children: toRuns(b.runs) }));
    }
  }

  const doc = new Document({
    title,
    creator: "Catelog Report Agent",
    sections: [{ children }],
  });
  return Packer.toBuffer(doc);
}
