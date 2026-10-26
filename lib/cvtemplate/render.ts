import "server-only";
import * as React from "react";
import { renderToBuffer } from "@react-pdf/renderer";
import { TemplateCVDocument } from "@/lib/pdf/template-cv";
import { pdfPageCount } from "@/lib/pdf/render";
import type { TemplateCvDoc } from "./assemble";

const SCALES = [1, 0.96, 0.92, 0.88];
const MAX_DROPS = 12;

async function render(doc: TemplateCvDoc, scale: number): Promise<Buffer> {
  return renderToBuffer(React.createElement(TemplateCVDocument, { doc, scale }) as any);
}

/** Retire la dernière puce de l'entrée la plus basse qui en garde au moins deux. */
function dropOneBullet(doc: TemplateCvDoc): { doc: TemplateCvDoc; dropped: string } | null {
  for (let si = doc.sections.length - 1; si >= 0; si--) {
    const entries = doc.sections[si].entries;
    for (let ei = entries.length - 1; ei >= 0; ei--) {
      if (entries[ei].bullets.length < 2) continue;
      const dropped = entries[ei].bullets[entries[ei].bullets.length - 1].id;
      const sections = doc.sections.map((s, i) =>
        i !== si ? s : { ...s, entries: s.entries.map((e, j) => (j !== ei ? e : { ...e, bullets: e.bullets.slice(0, -1) })) }
      );
      return { doc: { ...doc, sections }, dropped };
    }
  }
  return null;
}

/**
 * PDF d'une page : réduction progressive de la mise en page, puis retrait des
 * puces du bas du CV (signalé dans les avertissements). Renvoie aussi le
 * document final pour que le DOCX ait exactement le même contenu.
 */
export async function fitTemplateCvToOnePage(doc: TemplateCvDoc): Promise<{ pdf: Buffer; doc: TemplateCvDoc; scale: number }> {
  for (const scale of SCALES) {
    const pdf = await render(doc, scale);
    if ((await pdfPageCount(pdf)) <= 1) return { pdf, doc, scale };
  }
  const scale = SCALES[SCALES.length - 1];
  let current = doc;
  const dropped: string[] = [];
  let pdf = await render(current, scale);
  for (let i = 0; i < MAX_DROPS && (await pdfPageCount(pdf)) > 1; i++) {
    const next = dropOneBullet(current);
    if (!next) break;
    current = next.doc;
    dropped.push(next.dropped);
    pdf = await render(current, scale);
  }
  const warnings = [...current.warnings];
  if (dropped.length) warnings.push(`Puces retirées pour tenir sur une page : ${dropped.join(", ")}.`);
  if ((await pdfPageCount(pdf)) > 1) warnings.push("Le CV dépasse une page : raccourcissez des puces dans Modèle CV.");
  return { pdf, doc: { ...current, warnings }, scale };
}
