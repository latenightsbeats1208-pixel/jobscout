import { NextRequest, NextResponse } from "next/server";
import { getProfile } from "@/lib/db/queries";
import { getOffre } from "@/lib/db/offres";
import { generateCV } from "@/lib/ai/generate-cv";
import { genericFailure, translateAiError } from "@/lib/ai/errors";
import { fitCVToOnePage } from "@/lib/pdf/render";
import { renderCVDocx } from "@/lib/docx/render";
import { saveDocument } from "@/lib/db/documents";
import { detectDocLanguage, sourceLanguageHint } from "@/lib/text/lang";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  try {
    const { offreId } = await req.json();
    const profile = getProfile();
    if (!profile) return NextResponse.json({ error: "Profil introuvable" }, { status: 400 });
    const offre = getOffre(Number(offreId));
    if (!offre) return NextResponse.json({ error: "Offre introuvable" }, { status: 404 });

    // Langue des documents : déduite de l'offre (anglais si elle domine nettement),
    // transmise au modèle, au validateur, à la relecture et aux templates.
    const lang = detectDocLanguage(offre.title, offre.description_text, sourceLanguageHint(offre.source, offre.raw_payload), offre.country);
    const initialCV = await generateCV(profile, offre, lang);
    // Fit to 1 page — returns the (possibly shrunk) cv data + the validated PDF
    const { pdf, cv } = await fitCVToOnePage(initialCV, lang);
    const docx = await renderCVDocx(cv, lang); // DOCX uses the SAME shrunk content

    const meta = { company: offre.company, title: offre.title };
    const pdfDoc = saveDocument({ type: "cv", offreId: offre.id, format: "pdf", buffer: pdf, meta });
    saveDocument({ type: "cv", offreId: offre.id, format: "docx", buffer: docx, meta });

    return NextResponse.json({ ok: true, document_id: pdfDoc.id, language: lang });
  } catch (e) {
    const ai = translateAiError(e);
    if (ai) return NextResponse.json({ error: ai.message }, { status: ai.status });
    return NextResponse.json(
      { error: genericFailure("generate/cv", e) },
      { status: 500 }
    );
  }
}
