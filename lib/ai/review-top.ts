import "server-only";
import type { ProfileFull } from "@/lib/cv/types";
import { getDb, getSetting, parseJson } from "@/lib/db";
import { setOffreReview } from "@/lib/db/offres";
import { syncDuplicates } from "@/lib/db/duplicates";
import { reviewOffres } from "./review-offres";
import { currentReviews, loadScoringRows, rescoreAllOffres } from "@/lib/scoring/rescore";

/** Réglage « relire automatiquement après chaque scan » : "1" activé, absent ou autre désactivé. */
export const AUTO_REVIEW_SETTING = "review:auto";
/** Offres relues après un scan : les mieux notées, comme le bouton « Relire avec l'IA ». */
export const AUTO_REVIEW_LIMIT = 30;

export function autoReviewEnabled(): boolean {
  return getSetting(AUTO_REVIEW_SETTING) === "1";
}

export type ReviewTopResult = { reviewed: number; cached: number; unreadable: number; failedBatches: number };

/**
 * Relit par l'IA les meilleures offres encore dans les critères (payant : un
 * appel par lot de 8), puis recalcule les notes. Seules les offres sans
 * relecture valable pour ce profil sont envoyées : une offre déjà relue, ou
 * dont un doublon l'a été, ne coûte rien.
 */
export async function reviewTopOffres(profile: ProfileFull, limit: number): Promise<ReviewTopResult> {
  syncDuplicates();
  const rows = loadScoringRows();
  const cached = currentReviews(profile, rows);
  const meta = new Map(
    (getDb().prepare("SELECT id, score, score_breakdown, duplicate_of, closed_at FROM offres").all() as {
      id: number;
      score: number | null;
      score_breakdown: string | null;
      duplicate_of: number | null;
      closed_at: string | null;
    }[]).map((r) => [r.id, r])
  );
  // Les meilleures offres encore dans les critères — langue, pays, expérience
  // sont jugés localement et ne coûtent rien.
  const head = rows
    .map((r, i) => ({ r, cached: cached[i], m: meta.get(r.id) }))
    .filter((x) => !parseJson<{ excluded?: string } | null>(x.m?.score_breakdown, null)?.excluded)
    // Une description d'un autre poste ne vaut pas un appel payant, ni une
    // offre retirée, ni un doublon d'une offre déjà dans la liste.
    .filter((x) => x.r.description_status !== "failed")
    .filter((x) => x.m?.duplicate_of == null && !x.m?.closed_at)
    .sort((a, b) => (b.m?.score ?? 0) - (a.m?.score ?? 0))
    .slice(0, limit);
  const todo = head.filter((x) => !x.cached);
  if (!todo.length) return { reviewed: 0, cached: head.length, unreadable: 0, failedBatches: 0 };

  const { reviews, failedBatches } = await reviewOffres(profile, todo.map((x) => x.r));
  let reviewed = 0;
  reviews.forEach((review, i) => {
    if (!review) return;
    setOffreReview(todo[i].r.id, review);
    reviewed++;
  });
  rescoreAllOffres(profile);
  return { reviewed, cached: head.length - todo.length, unreadable: todo.length - reviewed, failedBatches };
}
