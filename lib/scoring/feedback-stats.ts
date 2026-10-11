import "server-only";
import { getProfile } from "@/lib/db/queries";
import { listJudgedOffers } from "@/lib/db/feedback";
import { MIN_FEEDBACK_PER_SIDE, type FeedbackStats } from "@/lib/feedback";
import { buildCorpus, scoreOffresLocal } from "./local";
import { currentReviews, loadScoringRows } from "./rescore";

/**
 * Accord entre une note et les avis : part des paires (offre 👍, offre 👎) où
 * la note place le 👍 devant, les égalités comptant pour moitié (AUC). 50 % :
 * la note ne fait pas mieux que le hasard ; 100 % : elle range tous les 👍
 * devant tous les 👎.
 */
export function pairwiseAgreement(up: number[], down: number[]): number | null {
  if (up.length < MIN_FEEDBACK_PER_SIDE || down.length < MIN_FEEDBACK_PER_SIDE) return null;
  let wins = 0;
  for (const u of up) for (const d of down) wins += u > d ? 1 : u === d ? 0.5 : 0;
  return wins / (up.length * down.length);
}

export function computeFeedbackStats(): FeedbackStats {
  const judged = listJudgedOffers();
  const ups = judged.filter((j) => j.verdict === "up");
  const downs = judged.filter((j) => j.verdict === "down");

  const reasonCounts = new Map<string, number>();
  for (const d of downs) if (d.reason) reasonCounts.set(d.reason, (reasonCounts.get(d.reason) ?? 0) + 1);
  const reasons = [...reasonCounts].map(([id, count]) => ({ id, count })).sort((a, b) => b.count - a.count);

  const stats: FeedbackStats = {
    up: ups.filter((j) => !j.implicit).length,
    implicitUp: ups.filter((j) => j.implicit).length,
    down: downs.length,
    agreement: pairwiseAgreement(ups.map((j) => j.score), downs.map((j) => j.score)),
    agreementLocal: null,
    reviewedJudged: 0,
    reasons,
  };

  // La note affichée intègre les relectures par l'IA : on mesure aussi la note
  // locale seule, recalculée sans elles, pour savoir ce que la relecture apporte.
  const profile = getProfile();
  if (profile && stats.agreement !== null) {
    const rows = loadScoringRows();
    const reviews = currentReviews(profile, rows);
    const judgedIds = new Set(judged.map((j) => j.id));
    stats.reviewedJudged = rows.filter((r, i) => judgedIds.has(r.id) && reviews[i]).length;
    if (stats.reviewedJudged > 0) {
      const local = scoreOffresLocal(profile, rows, buildCorpus(rows));
      const localById = new Map(rows.map((r, i) => [r.id, local[i].score]));
      stats.agreementLocal = pairwiseAgreement(
        ups.map((j) => localById.get(j.id) ?? 0),
        downs.map((j) => localById.get(j.id) ?? 0)
      );
    }
  }
  return stats;
}
