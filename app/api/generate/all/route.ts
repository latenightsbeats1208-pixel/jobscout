import { NextRequest, NextResponse } from "next/server";
import { getProfile } from "@/lib/db/queries";
import { getOffre } from "@/lib/db/offres";
import { generateCV } from "@/lib/ai/generate-cv";
import { generateLM } from "@/lib/ai/generate-lm";
import { genericFailure, translateAiError } from "@/lib/ai/errors";
import { fitCVToOnePage, fitLMToOnePage } from "@/lib/pdf/render";
import { renderCVDocx, renderLMDocx } from "@/lib/docx/render";
import { saveDocument, offreFolderPath } from "@/lib/db/documents";
import { detectDocLanguage, sourceLanguageHint } from "@/lib/text/lang";
import { countryNameEnglish } from "@/lib/countries";

export const runtime = "nodejs";
export const maxDuration = 180;

/**
 * Generate CV + LM together in parallel.
 * Returns the document IDs for both PDF and DOCX of each.
 */
export async function POST(req: NextRequest) {
  try {
    const { offreId } = await req.json();
    const profile = getProfile();
    if (!profile) return NextResponse.json({ error: "Profil introuvable" }, { status: 400 });
    const offre = getOffre(Number(offreId));
    if (!offre) return NextResponse.json({ error: "Offre introuvable" }, { status: 404 });

    const identity = {
      full_name: profile.full_name ?? "",
      email: profile.email ?? null,
      phone: profile.phone ?? null,
      location: profile.location ?? null,
      linkedin_url: profile.linkedin_url ?? null,
      portfolio_url: profile.portfolio_url ?? null,
    };
    // Langue des documents : déduite de l'offre (anglais si elle domine nettement),
    // transmise au modèle, au validateur, à la relecture et aux templates.
    const lang = detectDocLanguage(offre.title, offre.description_text, sourceLanguageHint(offre.source, offre.raw_payload), offre.country);
    const meta = { company: offre.company, title: offre.title };

    // Run CV and LM generation in parallel — saves a few seconds.
    // Promise.allSettled (DESIGN.md §6.4) : si UNE branche échoue, l'autre a
    // peut-être déjà sauvegardé ses documents. On renvoie l'erreur traduite
    // MAIS aussi ce qui a réussi — plus de document orphelin silencieux.
    const [cvSettled, lmSettled] = await Promise.allSettled([
      (async () => {
        const initialCV = await generateCV(profile, offre, lang);
        const { pdf, cv } = await fitCVToOnePage(initialCV, lang);
        const docx = await renderCVDocx(cv, lang);
        const pdfDoc = saveDocument({
          type: "cv",
          offreId: offre.id,
          format: "pdf",
          buffer: pdf,
          meta,
        });
        const docxDoc = saveDocument({
          type: "cv",
          offreId: offre.id,
          format: "docx",
          buffer: docx,
          meta,
        });
        return { pdfId: pdfDoc.id, docxId: docxDoc.id };
      })(),
      (async () => {
        const initialLM = await generateLM(profile, offre, lang);
        const { pdf, lm } = await fitLMToOnePage({
          identity,
          company: offre.company,
          companyLocation: lang === "en" ? countryNameEnglish(offre.country) : offre.country,
          lm: initialLM,
          language: lang,
        });
        const docx = await renderLMDocx({
          identity,
          company: offre.company,
          companyLocation: lang === "en" ? countryNameEnglish(offre.country) : offre.country,
          lm,
          language: lang,
        });
        const pdfDoc = saveDocument({
          type: "lm",
          offreId: offre.id,
          format: "pdf",
          buffer: pdf,
          meta,
        });
        const docxDoc = saveDocument({
          type: "lm",
          offreId: offre.id,
          format: "docx",
          buffer: docx,
          meta,
        });
        return { pdfId: pdfDoc.id, docxId: docxDoc.id };
      })(),
    ]);

    const folder = offreFolderPath(offre.id, offre.company, offre.title);
    const cvResult = cvSettled.status === "fulfilled" ? cvSettled.value : null;
    const lmResult = lmSettled.status === "fulfilled" ? lmSettled.value : null;

    if (cvResult && lmResult) {
      return NextResponse.json({ ok: true, cv: cvResult, lm: lmResult, folder, language: lang });
    }

    // Au moins une branche a échoué : traduire la première erreur en FR et
    // signaler ce qui a quand même été généré (le client met à jour son état).
    const firstError =
      cvSettled.status === "rejected" ? cvSettled.reason : (lmSettled as PromiseRejectedResult).reason;
    const ai = translateAiError(firstError);
    const failedLabel = !cvResult && !lmResult ? "CV et LM" : !cvResult ? "le CV" : "la LM";
    const okLabel = cvResult ? "Le CV a bien été généré. " : lmResult ? "La LM a bien été générée. " : "";
    // Même règle que le catch global : jamais de message technique anglais.
    const message = ai ? ai.message : genericFailure("generate/all", firstError);
    return NextResponse.json(
      {
        error: `Échec de la génération pour ${failedLabel} : ${message} ${okLabel}`.trim(),
        cv: cvResult,
        lm: lmResult,
        folder: cvResult || lmResult ? folder : null,
      },
      { status: ai?.status ?? 500 }
    );
  } catch (e) {
    const ai = translateAiError(e);
    if (ai) return NextResponse.json({ error: ai.message }, { status: ai.status });
    return NextResponse.json(
      { error: genericFailure("generate/all", e) },
      { status: 500 }
    );
  }
}
