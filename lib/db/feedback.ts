import "server-only";
import { getDb } from "./index";
import { getProfile } from "./queries";
import type { FeedbackVerdict, OfferFeedback } from "@/lib/feedback";
import { profileHash } from "@/lib/scoring/review";

export function getFeedback(offreId: number): OfferFeedback | null {
  const row = getDb()
    .prepare("SELECT verdict, reason FROM offre_feedback WHERE offre_id = ?")
    .get(offreId) as { verdict: FeedbackVerdict; reason: string | null } | undefined;
  return row ? { verdict: row.verdict, reason: row.reason } : null;
}

/**
 * Enregistre l'avis (null : le retire). Garde la note affichée et l'empreinte
 * du profil à ce moment-là : un avis donné à une note ancienne, ou pour un autre
 * profil, reste interprétable.
 */
export function setFeedback(offreId: number, feedback: OfferFeedback | null): OfferFeedback | null {
  const db = getDb();
  if (!feedback) {
    db.prepare("DELETE FROM offre_feedback WHERE offre_id = ?").run(offreId);
    return null;
  }
  const scoreAt = (db.prepare("SELECT score FROM offres WHERE id = ?").get(offreId) as { score: number | null } | undefined)?.score ?? null;
  const profile = getProfile();
  db.prepare(
    `INSERT INTO offre_feedback (offre_id, verdict, reason, score_at, profile_hash)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(offre_id) DO UPDATE SET
       verdict = excluded.verdict, reason = excluded.reason, score_at = excluded.score_at,
       profile_hash = excluded.profile_hash, updated_at = datetime('now')`
  ).run(offreId, feedback.verdict, feedback.reason, scoreAt, profile ? profileHash(profile) : null);
  return feedback;
}

export type JudgedOffer = {
  id: number;
  score: number;
  /** 'up' / 'down' explicite, ou 'up' déduit d'une candidature sans avis. */
  verdict: FeedbackVerdict;
  implicit: boolean;
  reason: string | null;
};

/** Offres jugées : avis explicites, plus les candidatures sans avis, comptées comme 👍. */
export function listJudgedOffers(): JudgedOffer[] {
  const rows = getDb()
    .prepare(
      `SELECT o.id, COALESCE(o.score, 0) AS score, f.verdict, f.reason,
         EXISTS(SELECT 1 FROM candidatures c WHERE c.offre_id = o.id) AS applied
       FROM offres o LEFT JOIN offre_feedback f ON f.offre_id = o.id
       WHERE f.verdict IS NOT NULL OR EXISTS(SELECT 1 FROM candidatures c WHERE c.offre_id = o.id)`
    )
    .all() as { id: number; score: number; verdict: FeedbackVerdict | null; reason: string | null; applied: number }[];
  return rows.map((r) => ({
    id: r.id,
    score: r.score,
    verdict: r.verdict ?? "up",
    implicit: !r.verdict,
    reason: r.reason,
  }));
}
