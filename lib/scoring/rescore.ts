import "server-only";
import type { ProfileFull } from "@/lib/cv/types";
import { getDb, getSetting, parseJson, setSetting, transaction } from "@/lib/db";
import { getProfile } from "@/lib/db/queries";
import { setOffreScore } from "@/lib/db/offres";
import { buildCorpus, scoreOffresLocal, type Corpus, type ScoringInput } from "./local";
import { REVIEW_VERSION, isReviewCurrent, offerHash, profileHash, type AiReview } from "./review";

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
  return rows.map((r) =>
    r.description_status === "failed" ? { ...r, description_text: "", language_text: r.description_text } : r
  );
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

/**
 * À changer à chaque modification de la note locale (lib/scoring/*). Les notes
 * sont écrites en base : sans ce repère, une mise à jour de la note ne touchait
 * les offres déjà collectées qu'au prochain scan ou au prochain enregistrement
 * du profil — 1 103 offres classées selon l'ancienne règle d'ici là.
 */
export const SCORING_VERSION = "2026-10-13";
const SETTING = "scoring:version";

/** Recalcule toutes les notes si elles datent d'une autre version de la note ou de la relecture. */
export function ensureScoresCurrent(): boolean {
  const version = `${SCORING_VERSION}+${REVIEW_VERSION}`;
  if (getSetting(SETTING) === version) return false;
  const profile = getProfile();
  if (!profile) return false;
  rescoreAllOffres(profile);
  setSetting(SETTING, version);
  return true;
}
