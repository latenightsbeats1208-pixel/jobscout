import { NextRequest, NextResponse } from "next/server";
import { extractText } from "@/lib/cv/text-extract";
import { extractCV } from "@/lib/cv/extract-semantic";
import { buildProfileFromExtraction } from "@/lib/cv/validate";
import { planMerge, applyMerge, fillMissingIdentity } from "@/lib/cv/merge";
import { getProfile, saveProfile } from "@/lib/db/queries";
import { setSetting } from "@/lib/db";
import { ProfileFullSchema } from "@/lib/cv/types";
import { getLlmConfig, LlmNotConfiguredError } from "@/lib/ai/client";
import { genericFailure, translateAiError } from "@/lib/ai/errors";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  try {
    return await handleMerge(req);
  } catch (e) {
    const ai = translateAiError(e);
    if (ai) return NextResponse.json({ error: ai.message }, { status: ai.status });
    return NextResponse.json(
      { error: genericFailure("profile/merge", e) },
      { status: 500 }
    );
  }
}

async function handleMerge(req: NextRequest) {
  const ct = req.headers.get("content-type") ?? "";

  // Step 2: confirm + apply
  if (ct.startsWith("application/json")) {
    // try/catch JSON : un corps malformé doit produire un 400 propre, pas un
    // crash 500 « Unexpected token » (DESIGN.md §6.4).
    const body = await req.json().catch(() => null);
    if (!body?.confirm || !body?.incoming) {
      return NextResponse.json({ error: "Payload invalide" }, { status: 400 });
    }
    const current = getProfile();
    if (!current) {
      return NextResponse.json(
        { error: "Aucun profil existant — utilisez l'import initial." },
        { status: 400 }
      );
    }
    const parsed = ProfileFullSchema.safeParse(body.incoming);
    if (!parsed.success) {
      return NextResponse.json({ error: "Profil entrant invalide" }, { status: 400 });
    }
    const plan = planMerge(current, parsed.data);
    const mergedRaw = applyMerge(current, plan);
    // Reprend nom / email / telephone / resume du CV entrant SI le profil ne les
    // a pas encore (profil de demonstration seede). N'ecrase jamais une valeur
    // deja renseignee par l'utilisateur.
    const { profile: merged, filled: filledIdentity } = fillMissingIdentity(mergedRaw, parsed.data);
    saveProfile({
      ...merged,
      raw_cv_text: [current.raw_cv_text, parsed.data.raw_cv_text].filter(Boolean).join("\n\n---\n\n"),
    });
    setSetting("has_completed_onboarding", "true");
    return NextResponse.json({
      ok: true,
      filledIdentity,
      added: {
        newExperiences: plan.newExperiences.length,
        enrichedExperiences: plan.enrichedExperiences.length,
        newEducations: plan.newEducations.length,
        enrichedEducations: plan.enrichedEducations.length,
        newSkills: plan.newSkills.length,
        newLanguages: plan.newLanguages.length,
      },
    });
  }

  // Step 1: extract + plan.
  // Refus AVANT toute lecture de fichier : /profile/add-cv n'a pas d'équivalent
  // du gate client d'UploadGate, et l'extraction de texte (PDF scanné -> OCR)
  // ferait attendre des dizaines de secondes pour un refus prévisible.
  if (getLlmConfig().mode === "unset") throw new LlmNotConfiguredError();
  const formData = await req.formData();
  const file = formData.get("cv");
  if (!file || !(file instanceof File)) {
    return NextResponse.json({ error: "Aucun fichier reçu" }, { status: 400 });
  }
  const buffer = Buffer.from(await file.arrayBuffer());
  const extraction = await extractText(buffer, file.name);

  if (extraction.wordCount < 50 || !extraction.hasCvKeywords) {
    return NextResponse.json(
      {
        error:
          "Impossible de lire correctement ce CV. Essayez un autre format (PDF texte, DOCX) ou un autre fichier.",
      },
      { status: 422 }
    );
  }

  const ai = await extractCV(extraction.text);
  const incoming = buildProfileFromExtraction(ai, extraction.text);

  const current = getProfile();
  if (!current) {
    return NextResponse.json(
      { error: "Aucun profil existant — utilisez l'import initial." },
      { status: 400 }
    );
  }

  const plan = planMerge(current, incoming);
  return NextResponse.json({
    incoming,
    plan: {
      newExperiences: plan.newExperiences,
      enrichedExperiences: plan.enrichedExperiences.map((e) => ({
        title: e.before.title,
        company: e.before.company,
        newBullets: e.newBullets,
        newSkills: e.newSkills,
      })),
      newEducations: plan.newEducations,
      enrichedEducations: plan.enrichedEducations.map((e) => ({
        school: e.before.school,
        degree: e.before.degree,
        newBullets: e.newBullets,
      })),
      newSkills: plan.newSkills,
      newLanguages: plan.newLanguages,
      duplicates: plan.duplicates,
    },
  });
}
