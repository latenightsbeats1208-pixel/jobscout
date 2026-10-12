import "server-only";
import type { ProfileFull } from "@/lib/cv/types";
import { getDb, parseJson, transaction } from "@/lib/db";
import { setOffreScore } from "@/lib/db/offres";
import { buildCorpus, scoreOffresLocal, type Corpus, type ScoringInput } from "./local";
import { isReviewCurrent, offerHash, profileHash, type AiReview } from "./review";

type ScoringRow = ScoringInput & { id: number; ai_review: string | null; description_status: string };

/**
 * Le strict nécessaire à la note, pour toutes les offres de la base. Une
 * description « failed » (celle d'un autre poste, une page de résultats) est
 * vidée : l'offre est notée sur son seul titre plutôt que sur un texte faux.
 */
export function loadScoringRows(): ScoringRow[] {
  const rows = getDb()
    .prepare("SELECT id, title, company, country, location, description_text, contract_type, ai_review, description_status FROM offres")
    .all() as ScoringRow[];
  return rows.map((r) => ({ ...r, description_text: r.description_status === "failed" ? "" : r.description_text }));
}

/** Rareté des mots mesurée sur toutes les offres de la base. */
export function loadCorpus(): Corpus {
  return buildCorpus(loadScoringRows());
}

/** Relectures par l'IA encore valables pour ce profil, alignées sur `rows`. */
export function currentReviews(profile: ProfileFull, rows: ScoringRow[]): (AiReview | null)[] {
  const pHash = profileHash(profile);
  return rows.map((r) => {
    const review = parseJson<AiReview | null>(r.ai_review, null);
    return isReviewCurrent(review, pHash, offerHash(r)) ? review : null;
  });
}

/**
 * Recalcule la note de TOUTES les offres avec la rareté mesurée sur l'ensemble,
 * en appliquant les relectures par l'IA encore valables (même profil, même
 * annonce). Pendant un scan, les premiers lots sont notés avec une rareté
 * calculée sur moins d'offres : ce recalcul final remet tout le monde sur la
 * même échelle.
 */
export function rescoreAllOffres(profile: ProfileFull): number {
  const rows = loadScoringRows();
  const results = scoreOffresLocal(profile, rows, buildCorpus(rows), currentReviews(profile, rows));
  transaction(() => results.forEach((r, i) => setOffreScore(rows[i].id, r)));
  return rows.length;
}
