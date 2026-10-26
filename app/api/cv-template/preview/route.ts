import { NextRequest, NextResponse } from "next/server";
import { getCvTemplate } from "@/lib/cvtemplate/store";
import { clusterSelection } from "@/lib/cvtemplate/inspect";
import { assembleTemplateCv } from "@/lib/cvtemplate/assemble";
import { fitTemplateCvToOnePage } from "@/lib/cvtemplate/render";
import { autoSelection } from "@/lib/cvtemplate/select";
import { getOffre } from "@/lib/db/offres";
import { detectDocLanguage, sourceLanguageHint, type DocLang } from "@/lib/text/lang";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Aperçu PDF sans IA ni enregistrement : `?cluster=B&lang=fr` (CV du cluster,
 * titre par défaut) ou `?offreId=12` (choix automatique pour cette offre).
 */
export async function GET(req: NextRequest) {
  const t = getCvTemplate();
  if (!t) return NextResponse.json({ error: "Aucun modèle de CV." }, { status: 404 });
  const sp = req.nextUrl.searchParams;
  const offreId = Number(sp.get("offreId"));
  let doc;
  if (offreId) {
    const offre = getOffre(offreId);
    if (!offre) return NextResponse.json({ error: "Offre introuvable" }, { status: 404 });
    const lang = detectDocLanguage(offre.title, offre.description_text, sourceLanguageHint(offre.source, offre.raw_payload), offre.country);
    doc = assembleTemplateCv(t, autoSelection(t, offre, lang), offre, lang);
  } else {
    const lang: DocLang = sp.get("lang") === "en" ? "en" : "fr";
    const country = (sp.get("country") ?? "").toUpperCase() || null;
    const offre = { title: "", description_text: "", country };
    doc = assembleTemplateCv(t, clusterSelection(t, sp.get("cluster") ?? "", lang), offre, lang);
  }
  const { pdf } = await fitTemplateCvToOnePage(doc);
  return new NextResponse(new Uint8Array(pdf), {
    headers: { "content-type": "application/pdf", "content-disposition": "inline; filename=\"apercu-cv.pdf\"", "cache-control": "no-store" },
  });
}
