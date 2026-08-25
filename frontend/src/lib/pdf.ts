"use client";

/**
 * In-browser PDF text extraction — lets Credon read documents even when
 * the backend reader service is offline. Falls back gracefully.
 */

let pdfjs: typeof import("pdfjs-dist") | null = null;
let workerReady = false;

async function ensurePdfjs() {
  if (!pdfjs) {
    pdfjs = await import("pdfjs-dist");
  }
  if (!workerReady) {
    try {
      pdfjs.GlobalWorkerOptions.workerSrc = new URL(
        "pdfjs-dist/build/pdf.worker.min.mjs",
        import.meta.url
      ).toString();
    } catch {
      /* main-thread fallback */
    }
    workerReady = true;
  }
  return pdfjs;
}

export async function extractPdfText(file: File, maxChars = 14000): Promise<{ text: string; pages: number }> {
  const lib = await ensurePdfjs();
  const buffer = await file.arrayBuffer();
  const doc = await lib.getDocument({ data: buffer }).promise;

  let text = "";
  const pageBudget = Math.min(doc.numPages, 60);
  for (let i = 1; i <= pageBudget; i++) {
    if (text.length >= maxChars) break;
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items
      .map((item) => ("str" in item ? item.str : ""))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    if (pageText) text += `\n\n[Page ${i}] ${pageText}`;
  }

  if (text.length > maxChars) text = `${text.slice(0, maxChars)}\n\n[Document truncated for length]`;

  return { text: text.trim(), pages: doc.numPages };
}
