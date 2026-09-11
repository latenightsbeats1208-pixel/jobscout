import "server-only";
import * as React from "react";
import { renderToBuffer } from "@react-pdf/renderer";
import { CVDocument, LMDocument } from "./cv-template";
import { compareRecentFirst } from "@/lib/ai/cv-shape";
import type { GeneratedCV } from "@/lib/ai/generate-cv";
import type { GeneratedLM } from "@/lib/ai/generate-lm";
import type { DocLang } from "@/lib/text/lang";

// pdf-parse expose numpages — usage en .js pour éviter l'effet de bord d'import
async function pdfPageCount(buf: Buffer): Promise<number> {
  const pdfParse = (await import("pdf-parse/lib/pdf-parse.js")).default as (
    b: Buffer
  ) => Promise<{ numpages: number }>;
  try {
    const r = await pdfParse(buf);
    return r.numpages || 1;
  } catch {
    return 1;
  }
}

// =============================================================
// CV — render with 1-page guard (progressive shrinking)
// =============================================================

function shrinkCV(cv: GeneratedCV, level: number): GeneratedCV {
  const expCap = Math.max(2, 4 - level);
  const bulletCap = Math.max(2, 4 - level);
  const eduCap = Math.max(1, 3 - level);
  const skillsCap = Math.max(10, 25 - level * 4);
  const summaryWords = Math.max(35, 90 - level * 18);
  const eduBulletCap = Math.max(0, 2 - level);

  // Même comparateur que generate-cv : les dates arrivent en MM/AAAA, pas en ISO.
  const sortedExp = [...cv.sections.experiences].sort(compareRecentFirst);

  const experiences = sortedExp.slice(0, expCap).map((e) => ({
    ...e,
    bullet_points: (e.bullet_points ?? [])
      .slice(0, bulletCap)
      .map((b) => trimSentence(b, level)),
  }));
  const educations = cv.sections.educations.slice(0, eduCap).map((e) => ({
    ...e,
    bullet_points: (e.bullet_points ?? []).slice(0, eduBulletCap),
  }));
  let summary = cv.summary ?? "";
  const words = summary.split(/\s+/);
  if (words.length > summaryWords) {
    summary = words.slice(0, summaryWords).join(" ").replace(/[,;:]?$/, "") + ".";
  }
  const skills_flat = (cv.sections.skills_flat ?? []).slice(0, skillsCap);
  // Le projet entrepreneurial est le premier sacrifié quand la page déborde.
  const projects = (cv.sections.projects ?? [])
    .slice(0, level >= 3 ? 0 : 1)
    .map((p) => ({ ...p, bullet_points: (p.bullet_points ?? []).slice(0, Math.max(1, 3 - level)) }));

  return {
    ...cv,
    summary,
    sections: { ...cv.sections, experiences, educations, skills_flat, projects },
  };
}

function trimSentence(s: string, level: number): string {
  if (level < 2) return s;
  // For aggressive shrinking, hard cap at ~140 chars
  const max = level >= 3 ? 110 : 140;
  if (s.length <= max) return s;
  // Cut at last word boundary before max
  const cut = s.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > 60 ? cut.slice(0, lastSpace) : cut).trim() + "…";
}

/**
 * Renders CV to PDF, retrying with progressively shrunk content if it exceeds 1 page.
 * Returns BOTH the buffer AND the final cv data used (so DOCX can use the same content).
 */
export async function fitCVToOnePage(
  cv: GeneratedCV,
  language: DocLang = "fr"
): Promise<{ pdf: Buffer; cv: GeneratedCV }> {
  let current = cv;
  for (let level = 0; level < 4; level++) {
    const buf = await renderToBuffer(React.createElement(CVDocument, { cv: current, language }) as any);
    const pages = await pdfPageCount(buf);
    if (pages <= 1) return { pdf: buf, cv: current };
    current = shrinkCV(current, level + 1);
  }
  // Last resort
  const final = shrinkCV(current, 4);
  const buf = await renderToBuffer(React.createElement(CVDocument, { cv: final, language }) as any);
  return { pdf: buf, cv: final };
}

export async function renderCVPdf(cv: GeneratedCV, language: DocLang = "fr"): Promise<Buffer> {
  const { pdf } = await fitCVToOnePage(cv, language);
  return pdf;
}

// =============================================================
// LM — render with 1-page guard
// =============================================================

function shrinkLM(lm: GeneratedLM, level: number): GeneratedLM {
  // Trim each paragraph to a fraction of original length
  const factor = Math.max(0.55, 1 - level * 0.18);
  const paragraphs = lm.body_paragraphs.map((p) => {
    const words = p.split(/\s+/).filter(Boolean);
    const target = Math.max(20, Math.floor(words.length * factor));
    if (words.length <= target) return p;
    const cut = words.slice(0, target).join(" ").replace(/[,;:]?$/, "");
    return cut.endsWith(".") || cut.endsWith("!") || cut.endsWith("?") ? cut : cut + ".";
  });
  return { ...lm, body_paragraphs: paragraphs };
}

export async function fitLMToOnePage(args: {
  identity: GeneratedCV["identity"];
  company: string;
  companyLocation?: string | null;
  lm: GeneratedLM;
  language?: DocLang;
}): Promise<{ pdf: Buffer; lm: GeneratedLM }> {
  let current = args.lm;
  for (let level = 0; level < 4; level++) {
    const buf = await renderToBuffer(
      React.createElement(LMDocument, {
        identity: args.identity,
        recipient: { company: args.company, location: args.companyLocation ?? null },
        object: current.object,
        body_paragraphs: current.body_paragraphs,
        language: args.language ?? "fr",
      }) as any
    );
    const pages = await pdfPageCount(buf);
    if (pages <= 1) return { pdf: buf, lm: current };
    current = shrinkLM(current, level + 1);
  }
  const final = shrinkLM(current, 4);
  const buf = await renderToBuffer(
    React.createElement(LMDocument, {
      identity: args.identity,
      recipient: { company: args.company, location: args.companyLocation ?? null },
      object: final.object,
      body_paragraphs: final.body_paragraphs,
      language: args.language ?? "fr",
    }) as any
  );
  return { pdf: buf, lm: final };
}

export async function renderLMPdf(args: {
  identity: GeneratedCV["identity"];
  company: string;
  lm: GeneratedLM;
}): Promise<Buffer> {
  const { pdf } = await fitLMToOnePage(args);
  return pdf;
}
