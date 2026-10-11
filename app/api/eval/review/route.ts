import { NextRequest, NextResponse } from "next/server";
import { ProfileFullSchema } from "@/lib/cv/types";
import { genericFailure, translateAiError } from "@/lib/ai/errors";
import { reviewOffres, type ReviewInput } from "@/lib/ai/review-offres";

export const runtime = "nodejs";
export const maxDuration = 600;

/**
 * Banc d'évaluation de la relecture par l'IA (tests/scoring-ai-eval.test.ts) :
 * relit des offres pour un profil FICTIF fourni, sans rien écrire en base.
 * N'existe que sur un serveur démarré avec JOBSCOUT_EVAL=1 — l'appel passe
 * ainsi par la configuration d'IA de l'application, sans que le banc ait à
 * manipuler une clé.
 */
export async function POST(req: NextRequest) {
  if (process.env.JOBSCOUT_EVAL !== "1") return NextResponse.json({ error: "Introuvable" }, { status: 404 });
  try {
    const body = (await req.json()) as { profile: unknown; offres: ReviewInput[] };
    const profile = ProfileFullSchema.parse(body.profile);
    const { reviews, failedBatches } = await reviewOffres(profile, body.offres ?? []);
    return NextResponse.json({ reviews, failedBatches });
  } catch (e) {
    const ai = translateAiError(e);
    if (ai) return NextResponse.json({ error: ai.message }, { status: ai.status });
    return NextResponse.json({ error: genericFailure("eval/review", e) }, { status: 500 });
  }
}
