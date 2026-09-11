import { NextRequest, NextResponse } from "next/server";
import { getProfile } from "@/lib/db/queries";
import { getOffre } from "@/lib/db/offres";
import { generateLM } from "@/lib/ai/generate-lm";
import { genericFailure, translateAiError } from "@/lib/ai/errors";
import { fitLMToOnePage } from "@/lib/pdf/render";
import { renderLMDocx } from "@/lib/docx/render";
import { saveDocument } from "@/lib/db/documents";
import { detectDocLanguage, sourceLanguageHint } from "@/lib/text/lang";
import { countryNameEnglish } from "@/lib/countries";

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
    const initialLM = await generateLM(profile, offre, lang);
    const identity = {
      full_name: profile.full_name ?? "",
      email: profile.email ?? null,
      phone: profile.phone ?? null,
      location: profile.location ?? null,
      linkedin_url: profile.linkedin_url ?? null,
      portfolio_url: profile.portfolio_url ?? null,
    };
    // Fit to 1 page — returns the (possibly trimmed) lm data + the validated PDF
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

    const meta = { company: offre.company, title: offre.title };
    const pdfDoc = saveDocument({ type: "lm", offreId: offre.id, format: "pdf", buffer: pdf, meta });
    saveDocument({ type: "lm", offreId: offre.id, format: "docx", buffer: docx, meta });

    return NextResponse.json({ ok: true, document_id: pdfDoc.id, language: lang });
  } catch (e) {
    const ai = translateAiError(e);
    if (ai) return NextResponse.json({ error: ai.message }, { status: ai.status });
    return NextResponse.json(
      { error: genericFailure("generate/lm", e) },
      { status: 500 }
    );
  }
}
