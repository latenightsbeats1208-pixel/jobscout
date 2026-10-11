import { NextRequest, NextResponse } from "next/server";
import { getProfile } from "@/lib/db/queries";
import { getDb, parseJson } from "@/lib/db";
import { setOffreReview } from "@/lib/db/offres";
import { getLlmConfig, LlmNotConfiguredError } from "@/lib/ai/client";
import { genericFailure, translateAiError } from "@/lib/ai/errors";
import { reviewOffres } from "@/lib/ai/review-offres";
import { currentReviews, loadScoringRows, rescoreAllOffres } from "@/lib/scoring/rescore";

export const runtime = "nodejs";
export const maxDuration = 300;

const DEFAULT_LIMIT = 30;
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

    const rows = loadScoringRows();
    const cached = currentReviews(profile, rows);
    const meta = new Map(
      (getDb().prepare("SELECT id, score, score_breakdown FROM offres").all() as {
        id: number;
        score: number | null;
        score_breakdown: string | null;
      }[]).map((r) => [r.id, r])
    );
    // Les meilleures offres encore dans les critères — langue, pays, expérience
    // sont jugés localement et ne coûtent rien.
    const head = rows
      .map((r, i) => ({ r, cached: cached[i], m: meta.get(r.id) }))
      .filter((x) => !parseJson<{ excluded?: string } | null>(x.m?.score_breakdown, null)?.excluded)
      .sort((a, b) => (b.m?.score ?? 0) - (a.m?.score ?? 0))
      .slice(0, limit);
    const todo = head.filter((x) => !x.cached);

    const { reviews, failedBatches } = await reviewOffres(profile, todo.map((x) => x.r));
    let reviewed = 0;
    reviews.forEach((review, i) => {
      if (!review) return;
      setOffreReview(todo[i].r.id, review);
      reviewed++;
    });
    rescoreAllOffres(profile);

    return NextResponse.json({
      ok: true,
      reviewed,
      cached: head.length - todo.length,
      unreadable: todo.length - reviewed,
      failedBatches,
    });
  } catch (e) {
    const ai = translateAiError(e);
    if (ai) return NextResponse.json({ error: ai.message }, { status: ai.status });
    return NextResponse.json({ error: genericFailure("offres/review", e) }, { status: 500 });
  }
}
