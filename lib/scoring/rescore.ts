import "server-only";
import type { ProfileFull } from "@/lib/cv/types";
import { getDb, transaction } from "@/lib/db";
import { setOffreScore } from "@/lib/db/offres";
import { buildCorpus, scoreOffresLocal, type Corpus, type ScoringInput } from "./local";

type ScoringRow = ScoringInput & { id: number };

/** Le strict nécessaire à la note, pour toutes les offres de la base. */
export function loadScoringRows(): ScoringRow[] {
  const rows = getDb()
    .prepare("SELECT id, title, company, country, location, description_text, contract_type FROM offres")
    .all() as ScoringRow[];
  return rows.map((r) => ({ ...r }));
}

/** Rareté des mots mesurée sur toutes les offres de la base. */
export function loadCorpus(): Corpus {
  return buildCorpus(loadScoringRows());
}

/**
 * Recalcule la note de TOUTES les offres avec la rareté mesurée sur l'ensemble.
 * Pendant un scan, les premiers lots sont notés avec une rareté calculée sur
 * moins d'offres : ce recalcul final remet tout le monde sur la même échelle.
 */
export function rescoreAllOffres(profile: ProfileFull): number {
  const rows = loadScoringRows();
  const results = scoreOffresLocal(profile, rows, buildCorpus(rows));
  transaction(() => results.forEach((r, i) => setOffreScore(rows[i].id, r)));
  return rows.length;
}
