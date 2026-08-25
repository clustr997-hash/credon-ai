"use client";

/**
 * Artifact exporters — client-side PDF (jsPDF) and PPTX (pptxgenjs).
 * Works with the backend offline.
 */

export type Slide = { title: string; bullets: string[]; notes?: string };

function stripMarkdown(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/[*_~`>]/g, "")
    .replace(/\${1,2}[^$]*\${1,2}/g, " ")
    .trim();
}

/** Parse "## Slide N:" sections into structured slides; falls back to chunking. */
export function extractSlides(md: string): Slide[] {
  const sections = md.split(/^##\s+Slide\s*\d*\s*[:.]?\s*/im).slice(1);
  if (sections.length >= 2) {
    return sections.map((section) => {
      const [titleLine, ...rest] = section.split("\n");
      const bullets = rest
        .join("\n")
        .split(/\n+/)
        .map((line) => stripMarkdown(line.replace(/^[-•*]\s*/, "").trim()))
        .filter((line) => line.length > 1)
        .slice(0, 6);
      return { title: stripMarkdown(titleLine).slice(0, 80), bullets };
    });
  }
  // fallback: split by H2/H3 sections
  const parts = md.split(/^##?\s+/m).slice(1);
  const source = parts.length >= 3 ? parts : chunk(md, 5);
  return source.map((part, i) => {
    const lines = part.split("\n").filter(Boolean);
    const title = stripMarkdown(lines[0] || `Section ${i + 1}`).slice(0, 70);
    const bullets = lines
      .slice(1)
      .join(" ")
      .split(/(?<=\.)\s+|\n+/)
      .map((s) => stripMarkdown(s.replace(/^[-•*]\s*/, "").trim()))
      .filter((s) => s.length > 2)
      .slice(0, 5);
    return { title, bullets };
  });
}

function chunk(text: string, paragraphsPerChunk: number): string[] {
  const paragraphs = text.split(/\n{2,}/).filter((p) => p.trim());
  const chunks: string[] = [];
  for (let i = 0; i < paragraphs.length; i += paragraphsPerChunk) {
    chunks.push(paragraphs.slice(i, i + paragraphsPerChunk).join("\n\n"));
  }
  return chunks.length ? chunks : [text];
}

export async function exportPdf(title: string, markdown: string): Promise<void> {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const margin = 56;
  const width = doc.internal.pageSize.getWidth() - margin * 2;
  const height = doc.internal.pageSize.getHeight();
  let y = margin;

  doc.setFillColor(11, 11, 13);
  doc.rect(0, 0, doc.internal.pageSize.getWidth(), 8, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.setTextColor(20, 20, 24);
  const titleLines = doc.splitTextToSize(title || "Credon", width);
  doc.text(titleLines, margin, y + 12);
  y += 20 + titleLines.length * 18;
  doc.setFontSize(9);
  doc.setTextColor(150, 90, 60);
  doc.text("Credon AI", margin, y);
  y += 24;
  doc.setTextColor(40, 40, 46);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10.5);

  const body = markdown.replace(/^###\s+(.*)$/gm, "\n» $1").replace(/^##\s+(.*)$/gm, "\n\n$1");
  for (const rawLine of body.split("\n")) {
    const line = rawLine.trimEnd();
    if (!line.trim()) {
      y += 8;
      continue;
    }
    const isHeading = line.startsWith("»");
    if (isHeading) {
      if (y > height - 90) {
        doc.addPage();
        y = margin;
      }
      y += 8;
      doc.setFont("helvetica", "bold");
      doc.setFontSize(12);
    }
    const wrapped = doc.splitTextToSize(line.replace(/^»\s*/, isHeading ? "" : ""), width);
    for (const piece of wrapped) {
      if (y > height - margin) {
        doc.addPage();
        y = margin;
      }
      doc.text(piece, margin, y);
      y += isHeading ? 17 : 14.5;
    }
    if (isHeading) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10.5);
      y += 2;
    }
  }

  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(160, 160, 165);
    doc.text(`Credon AI · ${new Date().toLocaleDateString()} · ${i}/${pageCount}`, margin, height - 24);
  }
  doc.save(`${sanitize(title) || "credon"}.pdf`);
}

export async function exportPptx(title: string, markdown: string): Promise<void> {
  const PptxGenJS = (await import("pptxgenjs")).default;
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_16x9";
  pptx.author = "Credon AI";

  const slides = extractSlides(markdown);
  const ink = "1C1917";
  const dim = "78716C";
  const accent = "C9653C";

  const cover = pptx.addSlide();
  cover.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: "100%", h: "100%", fill: { color: "0B0B0D" } });
  cover.addShape(pptx.ShapeType.ellipse, { x: 6.1, y: 1.15, w: 0.28, h: 0.28, fill: { color: accent } });
  cover.addText(title.slice(0, 90) || "Credon", {
    x: 0.6, y: 1.6, w: 8.8, fontSize: 34, bold: true, color: "FAF9F6", fontFace: "Georgia",
  });
  cover.addText("Built with Credon AI", { x: 0.62, y: 2.9, fontSize: 13, color: "A8A29E" });

  for (const slide of slides) {
    const s = pptx.addSlide();
    s.addText(slide.title || "Slide", {
      x: 0.55, y: 0.45, w: 8.9, fontSize: 24, bold: true, color: ink, fontFace: "Georgia",
    });
    s.addShape(pptx.ShapeType.rect, { x: 0.58, y: 1.12, w: 0.7, h: 0.045, fill: { color: accent } });
    if (slide.bullets.length) {
      s.addText(slide.bullets.map((b) => ({ text: b, options: { bullet: true, breakLine: true } })), {
        x: 0.62, y: 1.45, w: 8.75, h: 3.9, fontSize: 15, color: "292524", lineSpacingMultiple: 1.25, valign: "top",
      });
    }
    s.addText("Credon AI", { x: 8.7, y: 5.15, w: 1.1, fontSize: 9, color: dim, align: "right" });
  }

  await pptx.writeFile({ fileName: `${sanitize(title) || "credon-slides"}.pptx` });
}

function sanitize(name: string): string {
  return name.replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-").slice(0, 60).toLowerCase();
}
