/** Turns an agent's output into a PDF or Word file in the browser. Libraries load only when a download is clicked. */

/** One readable markdown document from the agent's output (text fields as text, anything else as JSON). */
export function outputToMarkdown(outputJson: string): string {
  let value: unknown;
  try {
    value = JSON.parse(outputJson);
  } catch {
    return outputJson;
  }
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    if (obj.truncated === true && typeof obj.preview === "string") return obj.preview;
    const entries = Object.entries(obj);
    const textCount = entries.filter(([, v]) => typeof v === "string").length;
    return entries
      .map(([k, v]) => {
        const body = typeof v === "string" ? v : "```json\n" + JSON.stringify(v, null, 2) + "\n```";
        return textCount > 1 || typeof v !== "string" ? `## ${k}\n\n${body}` : body;
      })
      .join("\n\n");
  }
  return "```json\n" + JSON.stringify(value, null, 2) + "\n```";
}

type Block =
  | { kind: "heading"; level: number; text: string }
  | { kind: "bullet"; text: string }
  | { kind: "number"; n: string; text: string }
  | { kind: "code"; text: string }
  | { kind: "para"; text: string };

function parseBlocks(md: string): Block[] {
  const blocks: Block[] = [];
  const lines = md.replace(/\r/g, "").split("\n");
  let para: string[] = [];
  let code: string[] | null = null;
  const flush = () => {
    if (para.length) blocks.push({ kind: "para", text: para.join(" ") });
    para = [];
  };
  for (const line of lines) {
    if (line.trim().startsWith("```")) {
      if (code) {
        blocks.push({ kind: "code", text: code.join("\n") });
        code = null;
      } else {
        flush();
        code = [];
      }
      continue;
    }
    if (code) {
      code.push(line);
      continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    const b = /^\s*[-*+]\s+(.*)$/.exec(line);
    const n = /^\s*(\d+)[.)]\s+(.*)$/.exec(line);
    if (h) {
      flush();
      blocks.push({ kind: "heading", level: h[1].length, text: h[2] });
    } else if (b) {
      flush();
      blocks.push({ kind: "bullet", text: b[1] });
    } else if (n) {
      flush();
      blocks.push({ kind: "number", n: n[1], text: n[2] });
    } else if (!line.trim()) {
      flush();
    } else {
      para.push(line.trim());
    }
  }
  flush();
  if (code) blocks.push({ kind: "code", text: (code as string[]).join("\n") });
  return blocks;
}

/** Inline markdown reduced to bold runs; links keep their text. */
function inlineRuns(text: string): Array<{ text: string; bold: boolean }> {
  const clean = text
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/(?<!\*)\*(?!\*)([^*]+)\*(?!\*)/g, "$1");
  return clean
    .split(/(\*\*[^*]+\*\*)/g)
    .filter(Boolean)
    .map((part) =>
      part.startsWith("**") && part.endsWith("**") ? { text: part.slice(2, -2), bold: true } : { text: part, bold: false },
    );
}

function save(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function downloadDocx(markdown: string, title: string, fileBase: string) {
  const { Document, Packer, Paragraph, TextRun, HeadingLevel } = await import("docx");
  const heading = [
    HeadingLevel.HEADING_1,
    HeadingLevel.HEADING_1,
    HeadingLevel.HEADING_2,
    HeadingLevel.HEADING_3,
    HeadingLevel.HEADING_4,
    HeadingLevel.HEADING_5,
    HeadingLevel.HEADING_6,
  ];
  const runs = (text: string) => inlineRuns(text).map((r) => new TextRun({ text: r.text, bold: r.bold }));
  const children = [
    new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun({ text: title })] }),
    ...parseBlocks(markdown).map((b) => {
      switch (b.kind) {
        case "heading":
          return new Paragraph({ heading: heading[b.level], spacing: { before: 240, after: 120 }, children: runs(b.text) });
        case "bullet":
          return new Paragraph({ bullet: { level: 0 }, children: runs(b.text) });
        case "number":
          return new Paragraph({ children: [new TextRun({ text: `${b.n}. ` }), ...runs(b.text)], indent: { left: 360 } });
        case "code":
          return new Paragraph({
            children: [new TextRun({ text: b.text, font: "Consolas", size: 20 })],
            spacing: { before: 120, after: 120 },
          });
        default:
          return new Paragraph({ spacing: { after: 160 }, children: runs(b.text) });
      }
    }),
  ];
  const blob = await Packer.toBlob(new Document({ sections: [{ children }] }));
  save(blob, `${fileBase}.docx`);
}

export async function downloadPdf(markdown: string, title: string, fileBase: string) {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const margin = 56;
  const width = doc.internal.pageSize.getWidth() - margin * 2;
  const bottom = doc.internal.pageSize.getHeight() - margin;
  let y = margin;

  const write = (text: string, size: number, bold: boolean, indent = 0, font: "helvetica" | "courier" = "helvetica", gap = 6) => {
    doc.setFont(font, bold ? "bold" : "normal");
    doc.setFontSize(size);
    for (const line of doc.splitTextToSize(text, width - indent) as string[]) {
      if (y + size > bottom) {
        doc.addPage();
        y = margin;
      }
      doc.text(line, margin + indent, y);
      y += size * 1.35;
    }
    y += gap;
  };
  // Built-in PDF fonts cannot mix bold into a line, so inline bold is dropped and only headings are bold.
  const plain = (t: string) => inlineRuns(t).map((r) => r.text).join("");

  write(title, 20, true, 0, "helvetica", 10);
  for (const b of parseBlocks(markdown)) {
    if (b.kind === "heading") write(plain(b.text), Math.max(12, 19 - b.level * 2), true, 0, "helvetica", 6);
    else if (b.kind === "bullet") write(`•  ${plain(b.text)}`, 11, false, 12, "helvetica", 3);
    else if (b.kind === "number") write(`${b.n}.  ${plain(b.text)}`, 11, false, 12, "helvetica", 3);
    else if (b.kind === "code") write(b.text, 9, false, 8, "courier", 8);
    else write(plain(b.text), 11, false, 0, "helvetica", 8);
  }
  doc.save(`${fileBase}.pdf`);
}
