import "server-only";
import { Document, Packer, Paragraph, TextRun, AlignmentType } from "docx";
import type { GeneratedCV } from "@/lib/ai/generate-cv";
import type { GeneratedLM } from "@/lib/ai/generate-lm";
import {
  typographyFor,
  formatLanguage,
  displayUrl,
  capitalizeFirst,
  eduYearRange,
  expDateRange,
  cleanJobTitle,
} from "@/lib/text/typography";
import { LABELS, letterDateLine, type DocLang } from "@/lib/text/lang";

const FONT = "Calibri";

// Half-points: 18 = 9pt, 19 = 9.5pt, 20 = 10pt
const SZ_BODY = 18;
const SZ_NAME = 26;
const SZ_SECTION = 20;

type Ty = (s: string | null | undefined) => string;

function sectionTitle(label: string): Paragraph {
  return new Paragraph({
    spacing: { before: 200, after: 80 },
    children: [
      new TextRun({ text: label.toUpperCase(), bold: true, size: SZ_SECTION, characterSpacing: 30, font: FONT }),
    ],
  });
}

function bulletParagraphs(items: string[], ty: Ty, after = 30): Paragraph[] {
  return items
    .filter((b) => b && b.trim())
    .map(
      (b) =>
        new Paragraph({
          bullet: { level: 0 },
          spacing: { after },
          children: [new TextRun({ text: ty(b), size: SZ_BODY, font: FONT })],
        })
    );
}

function headerLine(title: string, dates: string, extra?: string | null): Paragraph {
  const tail = [dates, extra].filter(Boolean).join("  |  ");
  return new Paragraph({
    spacing: { before: 100, after: 30 },
    children: [
      new TextRun({ text: title, bold: true, size: SZ_BODY + 1, font: FONT }),
      new TextRun({ text: tail ? `  |  ${tail}` : "", italics: true, size: SZ_BODY, color: "3a3a3c", font: FONT }),
    ],
  });
}

/**
 * CV DOCX — même contenu que le PDF (déjà réduit à une page), mêmes libellés
 * par langue (LABELS) et même typographie (française ou anglaise).
 */
export async function renderCVDocx(cv: GeneratedCV, language: DocLang = "fr"): Promise<Buffer> {
  const L = LABELS[language];
  const ty = typographyFor(language);
  const children: Paragraph[] = [];

  children.push(
    new Paragraph({
      children: [new TextRun({ text: cv.identity.full_name, bold: true, size: SZ_NAME, characterSpacing: 30, font: FONT })],
      spacing: { after: 60 },
    })
  );

  const contact = [
    cv.identity.phone,
    cv.identity.email,
    cv.identity.location,
    displayUrl(cv.identity.linkedin_url),
    displayUrl(cv.identity.portfolio_url),
  ].filter(Boolean) as string[];
  if (contact.length) {
    children.push(
      new Paragraph({
        children: [new TextRun({ text: contact.join("  |  "), size: SZ_BODY, font: FONT })],
        spacing: { after: 200 },
      })
    );
  }

  if (cv.summary) {
    children.push(sectionTitle(L.profile));
    children.push(
      new Paragraph({
        alignment: AlignmentType.JUSTIFIED,
        children: [new TextRun({ text: ty(cv.summary), size: SZ_BODY, font: FONT })],
        spacing: { after: 80 },
      })
    );
  }

  if (cv.sections.experiences.length) {
    children.push(sectionTitle(L.experience));
    for (const e of cv.sections.experiences) {
      const title = cleanJobTitle(e.title);
      children.push(
        headerLine(
          e.company ? `${title} — ${e.company}` : title,
          expDateRange(e.start_date, e.end_date, language),
          e.location
        )
      );
      children.push(...bulletParagraphs(e.bullet_points ?? [], ty));
    }
  }

  const projects = cv.sections.projects ?? [];
  if (projects.length) {
    children.push(sectionTitle(projects.length > 1 ? L.projects : L.project));
    for (const p of projects) {
      children.push(
        headerLine(p.role ? `${p.name} — ${p.role}` : p.name, expDateRange(p.start_date, p.end_date, language))
      );
      children.push(...bulletParagraphs(p.bullet_points ?? [], ty));
    }
  }

  if (cv.sections.educations.length) {
    children.push(sectionTitle(L.education));
    for (const e of cv.sections.educations) {
      children.push(
        new Paragraph({
          spacing: { before: 80, after: 20 },
          children: [
            new TextRun({ text: e.school, bold: true, size: SZ_BODY + 1, font: FONT }),
            new TextRun({
              text: `  |  ${eduYearRange(e.start_date, e.end_date, language)}`,
              italics: true,
              size: SZ_BODY,
              color: "3a3a3c",
              font: FONT,
            }),
          ],
        })
      );
      const degreeLine = [e.degree, e.field].filter(Boolean).join(" — ");
      if (degreeLine) {
        children.push(
          new Paragraph({
            spacing: { after: 30 },
            children: [new TextRun({ text: ty(degreeLine), italics: true, size: SZ_BODY, font: FONT })],
          })
        );
      }
      children.push(...bulletParagraphs(e.bullet_points ?? [], ty, 20));
    }
  }

  if (cv.sections.skills_flat?.length || cv.sections.languages.length) {
    children.push(sectionTitle(L.skills));
    if (cv.sections.skills_flat?.length) {
      children.push(
        new Paragraph({
          spacing: { after: 60 },
          children: [
            new TextRun({
              text: cv.sections.skills_flat.map((s) => capitalizeFirst(s)).join(" | "),
              size: SZ_BODY,
              font: FONT,
            }),
          ],
        })
      );
    }
    if (cv.sections.languages.length) {
      children.push(
        new Paragraph({
          children: [
            new TextRun({
              text: ty(
                `${L.languages} : ${cv.sections.languages
                  .map((l) => formatLanguage(l.name, l.level))
                  .join(" | ")}`
              ),
              bold: true,
              size: SZ_BODY,
              font: FONT,
            }),
          ],
        })
      );
    }
  }

  return await Packer.toBuffer(
    new Document({
      styles: { default: { document: { run: { font: FONT, size: SZ_BODY } } } },
      sections: [{ properties: { page: { margin: { top: 567, right: 720, bottom: 567, left: 720 } } }, children }],
    })
  );
}

// =============================================================
// Lettre de motivation — modèle de référence
// =============================================================

export async function renderLMDocx(args: {
  identity: GeneratedCV["identity"];
  company: string;
  companyLocation?: string | null;
  lm: GeneratedLM;
  language?: DocLang;
}): Promise<Buffer> {
  const { identity, companyLocation, lm } = args;
  const company = (args.company ?? "").trim();
  const language: DocLang = args.language ?? "fr";
  const L = LABELS[language];
  const ty = typographyFor(language);
  const senderCity = identity.location?.split(",")[0]?.trim() || null;
  const dateLine = letterDateLine(senderCity, language);

  const SZ = 21; // 10.5pt
  const body = (text: string, opts: { bold?: boolean } = {}) =>
    new TextRun({ text, size: SZ, font: FONT, bold: opts.bold });

  const children: Paragraph[] = [];

  children.push(new Paragraph({ children: [body(identity.full_name, { bold: true })] }));
  if (identity.phone) children.push(new Paragraph({ children: [body(identity.phone)] }));
  if (identity.email) children.push(new Paragraph({ children: [body(identity.email)] }));
  children.push(new Paragraph({ spacing: { after: 120 }, children: [] }));
  if (identity.location) children.push(new Paragraph({ spacing: { after: 240 }, children: [body(identity.location)] }));
  else children.push(new Paragraph({ spacing: { after: 120 }, children: [] }));

  children.push(new Paragraph({ spacing: { after: 240 }, children: [body(dateLine)] }));

  // Destinataire uniquement si l'entreprise est connue (jamais un pays seul).
  if (company) {
    children.push(new Paragraph({ children: [body(company)] }));
    if (companyLocation) children.push(new Paragraph({ spacing: { after: 240 }, children: [body(companyLocation)] }));
    else children.push(new Paragraph({ spacing: { after: 240 }, children: [] }));
  }

  children.push(
    new Paragraph({
      spacing: { after: 240 },
      children: [body(ty(`${L.subject} : ${cleanJobTitle(lm.object)}`), { bold: true })],
    })
  );
  children.push(new Paragraph({ spacing: { after: 200 }, children: [body(L.salutation)] }));

  for (const p of lm.body_paragraphs.filter((x) => x && x.trim())) {
    children.push(
      new Paragraph({ alignment: AlignmentType.JUSTIFIED, spacing: { after: 200 }, children: [body(ty(p))] })
    );
  }

  if (L.closing) {
    children.push(
      new Paragraph({ alignment: AlignmentType.JUSTIFIED, spacing: { after: 360 }, children: [body(L.closing)] })
    );
  }
  if (L.signoff) {
    children.push(new Paragraph({ spacing: { after: 360 }, children: [body(L.signoff)] }));
  }
  children.push(new Paragraph({ children: [body(identity.full_name, { bold: true })] }));

  return await Packer.toBuffer(
    new Document({
      styles: { default: { document: { run: { font: FONT, size: SZ } } } },
      sections: [{ properties: { page: { margin: { top: 850, right: 950, bottom: 850, left: 950 } } }, children }],
    })
  );
}
