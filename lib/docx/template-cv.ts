import "server-only";
import { AlignmentType, BorderStyle, Document, Packer, Paragraph, TextRun } from "docx";
import type { TemplateCvDoc } from "@/lib/cvtemplate/assemble";

// Même contenu que le PDF (déjà ajusté à une page), mise en forme Word équivalente.
const FONT = "Calibri";
const ACCENT = "1F3A5F";
// Demi-points : 18 = 9 pt.
const SZ = { body: 18, small: 17, name: 34, headline: 22, section: 20, entry: 19 };

function sectionTitle(text: string): Paragraph {
  return new Paragraph({
    spacing: { before: 180, after: 60 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: "9AA7B8", space: 1 } },
    children: [new TextRun({ text: text.toUpperCase(), bold: true, size: SZ.section, color: ACCENT, characterSpacing: 16, font: FONT })],
  });
}

function titleLine(heading: string, meta: string | null, before = 80): Paragraph {
  return new Paragraph({
    spacing: { before, after: 10 },
    children: [
      new TextRun({ text: heading, bold: true, size: SZ.entry, font: FONT }),
      ...(meta ? [new TextRun({ text: `  ·  ${meta}`, size: SZ.entry, color: "444444", font: FONT })] : []),
    ],
  });
}

export async function renderTemplateCvDocx(doc: TemplateCvDoc): Promise<Buffer> {
  const sep = doc.lang === "fr" ? " : " : ": ";
  const children: Paragraph[] = [
    new Paragraph({ spacing: { after: 0 }, children: [new TextRun({ text: doc.name, bold: true, size: SZ.name, color: ACCENT, font: FONT })] }),
    new Paragraph({ spacing: { after: 40 }, children: [new TextRun({ text: doc.headline, bold: true, size: SZ.headline, font: FONT })] }),
    new Paragraph({ children: [new TextRun({ text: doc.contact.join("  ·  "), size: SZ.small, color: "333333", font: FONT })] }),
  ];
  if (doc.tagline) children.push(new Paragraph({ children: [new TextRun({ text: doc.tagline, size: SZ.small, color: "333333", font: FONT })] }));

  if (doc.profile) {
    children.push(sectionTitle(doc.profileTitle));
    children.push(new Paragraph({ alignment: AlignmentType.JUSTIFIED, children: [new TextRun({ text: doc.profile, size: SZ.body, font: FONT })] }));
  }

  for (const s of doc.sections) {
    children.push(sectionTitle(s.title));
    for (const e of s.entries) {
      if (e.heading) children.push(titleLine(e.heading, e.meta));
      if (e.sub) children.push(new Paragraph({ spacing: { after: 10 }, children: [new TextRun({ text: e.sub, italics: true, size: SZ.small, color: "444444", font: FONT })] }));
      for (const b of e.bullets) {
        children.push(
          new Paragraph({
            bullet: { level: 0 },
            alignment: AlignmentType.JUSTIFIED,
            spacing: { after: 20 },
            children: [new TextRun({ text: b.text, size: SZ.body, font: FONT })],
          })
        );
      }
    }
  }

  if (doc.education.length) {
    children.push(sectionTitle(doc.educationTitle));
    for (const e of doc.education) children.push(titleLine(e.heading, e.meta, 30));
  }

  if (doc.skills.length) {
    children.push(sectionTitle(doc.skillsTitle));
    for (const s of doc.skills) {
      children.push(
        new Paragraph({
          spacing: { after: 20 },
          children: [new TextRun({ text: `${s.label}${sep}`, bold: true, size: SZ.body, font: FONT }), new TextRun({ text: s.items, size: SZ.body, font: FONT })],
        })
      );
    }
  }

  return Packer.toBuffer(
    new Document({
      creator: doc.name,
      title: `${doc.name} — ${doc.headline}`,
      styles: { default: { document: { run: { font: FONT, size: SZ.body } } } },
      sections: [{ properties: { page: { margin: { top: 567, right: 680, bottom: 567, left: 680 } } }, children }],
    })
  );
}
