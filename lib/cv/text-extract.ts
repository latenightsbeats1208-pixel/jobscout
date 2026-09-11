import "server-only";
import { detectFileKind, type FileKind } from "./detect";

const CV_KEYWORDS = /experience|formation|education|skills|comp[eé]tences|projet|profil|profile|career|emploi|stage|internship/i;

export type ExtractionResult = {
  text: string;
  kind: FileKind;
  strategy: string;
  wordCount: number;
  hasCvKeywords: boolean;
};

function score(text: string): { wordCount: number; hasCvKeywords: boolean; score: number } {
  const wordCount = text.trim().split(/\s+/).filter(Boolean).length;
  const hasCvKeywords = CV_KEYWORDS.test(text);
  return { wordCount, hasCvKeywords, score: wordCount + (hasCvKeywords ? 50 : 0) };
}

async function extractPdfFast(buffer: Buffer): Promise<string> {
  // pdf-parse is CommonJS and reads a test file at import time on some setups,
  // so we import the inner module path directly to avoid that side effect.
  const pdfParse = (await import("pdf-parse/lib/pdf-parse.js")).default as (
    b: Buffer
  ) => Promise<{ text: string }>;
  const result = await pdfParse(buffer);
  return result.text || "";
}

async function extractPdfStructured(buffer: Buffer): Promise<string> {
  // pdfjs-dist : preserves x/y coordinates so we can reconstruct multi-column layouts
  const pdfjs: any = await import("pdfjs-dist/legacy/build/pdf.mjs");
  // Ne PAS forcer GlobalWorkerOptions.workerSrc : le setter refuse toute valeur
  // qui n'est pas une chaîne et lève « Invalid `workerSrc` type », ce qui
  // annulait silencieusement cette stratégie (le multi-colonnes retombait
  // toujours sur pdf-parse). Côté Node, pdfjs charge de lui-même son faux
  // worker depuis pdf.worker.mjs, livré à côté de pdf.mjs.
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(buffer),
    useSystemFonts: true,
    disableFontFace: true,
    isEvalSupported: false,
  });
  const pdf = await loadingTask.promise;

  let allText = "";
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    const items = (content.items as any[])
      .filter((it) => "str" in it && typeof it.str === "string")
      .map((it) => ({
        str: it.str as string,
        x: it.transform[4] as number,
        y: it.transform[5] as number,
        h: (it.height as number) || 10,
      }));

    if (!items.length) continue;

    // Detect column boundary: cluster x-positions of starts
    const xs = items.map((i) => i.x).sort((a, b) => a - b);
    const minX = xs[0];
    const maxX = xs[xs.length - 1];
    const pageWidth = maxX - minX || 1;

    // Heuristic: if there is a meaningful gap in the middle, treat as 2 columns
    const mid = minX + pageWidth / 2;
    const leftCount = items.filter((i) => i.x < mid).length;
    const rightCount = items.length - leftCount;
    const hasTwoColumns =
      leftCount > 5 &&
      rightCount > 5 &&
      Math.abs(leftCount - rightCount) / items.length < 0.6;

    if (hasTwoColumns) {
      const left = items.filter((i) => i.x < mid).sort((a, b) => b.y - a.y || a.x - b.x);
      const right = items.filter((i) => i.x >= mid).sort((a, b) => b.y - a.y || a.x - b.x);
      allText += linesFromItems(left) + "\n\n" + linesFromItems(right) + "\n\n";
    } else {
      const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
      allText += linesFromItems(sorted) + "\n\n";
    }
  }
  return allText;
}

function linesFromItems(items: { str: string; x: number; y: number; h: number }[]): string {
  if (!items.length) return "";
  const lines: string[] = [];
  let currentY = items[0].y;
  let line: string[] = [];
  const tolerance = 3;
  for (const it of items) {
    if (Math.abs(it.y - currentY) > tolerance) {
      if (line.length) lines.push(line.join(" ").trim());
      line = [];
      currentY = it.y;
    }
    line.push(it.str);
  }
  if (line.length) lines.push(line.join(" ").trim());
  return lines.filter(Boolean).join("\n");
}

async function extractDocx(buffer: Buffer): Promise<string> {
  const mammoth = await import("mammoth");
  const result = await mammoth.extractRawText({ buffer });
  return result.value || "";
}

async function extractOcr(buffer: Buffer, kind: FileKind): Promise<string> {
  const Tesseract = await import("tesseract.js");
  // For PDFs, tesseract.js needs images. We'll only run OCR on raw images here.
  // PDF→image conversion is omitted (would require pdf2pic or sharp+pdfjs render).
  if (kind !== "image") return "";
  const { data } = await Tesseract.recognize(buffer, "fra+eng");
  return data.text || "";
}

export async function extractText(buffer: Buffer, filename?: string): Promise<ExtractionResult> {
  const kind = detectFileKind(buffer, filename);

  if (kind === "txt") {
    const text = buffer.toString("utf-8");
    const s = score(text);
    return { text, kind, strategy: "txt", wordCount: s.wordCount, hasCvKeywords: s.hasCvKeywords };
  }

  if (kind === "docx") {
    const text = await extractDocx(buffer);
    const s = score(text);
    return { text, kind, strategy: "mammoth", ...s };
  }

  if (kind === "image") {
    const text = await extractOcr(buffer, kind);
    const s = score(text);
    return { text, kind, strategy: "tesseract", ...s };
  }

  if (kind === "pdf") {
    // Strategy 1: pdf-parse
    let fast = "";
    try {
      fast = await extractPdfFast(buffer);
    } catch {
      fast = "";
    }
    const fastScore = score(fast);

    // Strategy 2: pdfjs-dist (multi-column aware)
    let structured = "";
    try {
      structured = await extractPdfStructured(buffer);
    } catch {
      structured = "";
    }
    const structScore = score(structured);

    // Pick the richer one. Prefer pdfjs if it found significantly more keywords/words.
    if (structScore.score > fastScore.score * 1.1) {
      return {
        text: structured,
        kind,
        strategy: "pdfjs",
        wordCount: structScore.wordCount,
        hasCvKeywords: structScore.hasCvKeywords,
      };
    }
    if (fastScore.wordCount >= 50) {
      return {
        text: fast,
        kind,
        strategy: "pdf-parse",
        wordCount: fastScore.wordCount,
        hasCvKeywords: fastScore.hasCvKeywords,
      };
    }
    // Both poor → likely scanned PDF. We don't OCR PDFs server-side here (heavy);
    // we surface the failure to the UI so the user can re-upload as image or try another file.
    return {
      text: structured || fast,
      kind,
      strategy: "pdf-empty",
      wordCount: Math.max(structScore.wordCount, fastScore.wordCount),
      hasCvKeywords: structScore.hasCvKeywords || fastScore.hasCvKeywords,
    };
  }

  return { text: "", kind, strategy: "none", wordCount: 0, hasCvKeywords: false };
}
