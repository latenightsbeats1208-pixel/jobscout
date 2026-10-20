import { NextRequest, NextResponse } from "next/server";
import { getProfile } from "@/lib/db/queries";
import { getLlmConfig, LlmNotConfiguredError } from "@/lib/ai/client";
import { genericFailure, translateAiError } from "@/lib/ai/errors";
import { AUTO_REVIEW_LIMIT, reviewTopOffres } from "@/lib/ai/review-top";

export const runtime = "nodejs";
export const maxDuration = 300;

const DEFAULT_LIMIT = AUTO_REVIEW_LIMIT;
const MAX_LIMIT = 60;

/**
 * Relecture par l'IA des meilleures offres (payant : un appel par lot de 8).
 * Seules les offres retenues par les filtres locaux sont relues, et seulement
 * si elles n'ont pas déjà une relecture valable pour ce profil. Les notes sont
 * ensuite recalculées : la relecture remplace la pertinence locale, et son
 * filtre de compétences peut écarter une offre.
 */
export async function POST(req: NextRequest) {
  try {
    const profile = getProfile();
    if (!profile) return NextResponse.json({ error: "Profil introuvable" }, { status: 400 });
    if (getLlmConfig().mode === "unset") throw new LlmNotConfiguredError();

    const body = (await req.json().catch(() => ({}))) as { limit?: number };
    const limit = Math.max(1, Math.min(MAX_LIMIT, Math.trunc(Number(body.limit) || DEFAULT_LIMIT)));

    const { reviewed, cached, unreadable, failedBatches } = await reviewTopOffres(profile, limit);

    return NextResponse.json({ ok: true, reviewed, cached, unreadable, failedBatches });
  } catch (e) {
    const ai = translateAiError(e);
    if (ai) return NextResponse.json({ error: ai.message }, { status: ai.status });
    return NextResponse.json({ error: genericFailure("offres/review", e) }, { status: 500 });
  }
}
