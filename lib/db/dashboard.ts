import "server-only";
import { getDb } from "./index";
import { syncDuplicates } from "./duplicates";
import { VISIBLE_SQL } from "./offres";
import { detectVie } from "@/lib/vie";

// Requêtes propres à l'accueil. Les chiffres affichés doivent concorder avec la page
// vers laquelle chaque carte renvoie : on réutilise donc les mêmes règles que la liste,
// qui ne compte ni les doublons regroupés ni les offres retirées par leur source.

const RECENT_DAYS = 7;

export type DashboardFigure = { total: number; recent: number };

// « Récente » = publiée depuis RECENT_DAYS jours ou moins, calculé par SQLite pour les deux cartes.
const RECENT_SQL = `(posted_at IS NOT NULL AND julianday('now') - julianday(posted_at) <= ${RECENT_DAYS})`;

/**
 * V.I.E : même détection que la catégorie de contrat « vie » de la liste des offres
 * (`classifyContract` commence par `detectVie`), pas l'ancienne colonne `is_vie`,
 * pour que le chiffre de la carte corresponde à /offres?vie=1.
 * `detectVie` ne lit que les 4 000 premiers caractères de la description.
 */
export function vieFigure(): DashboardFigure {
  syncDuplicates();
  const rows = getDb()
    .prepare(`SELECT source, url, title, substr(description_text, 1, 4000) AS description, ${RECENT_SQL} AS recent FROM offres WHERE ${VISIBLE_SQL}`)
    .all() as { source: string; url: string | null; title: string | null; description: string | null; recent: number }[];
  let total = 0;
  let recent = 0;
  for (const row of rows) {
    if (!detectVie(row)) continue;
    total++;
    if (row.recent) recent++;
  }
  return { total, recent };
}

/** Offres dont le score atteint `threshold` (70 par défaut). */
export function highScoreFigure(threshold = 70): DashboardFigure {
  syncDuplicates();
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) AS total,
              COALESCE(SUM(${RECENT_SQL}), 0) AS recent
       FROM offres WHERE score >= ? AND ${VISIBLE_SQL}`
    )
    .get(threshold) as { total: number; recent: number };
  return { total: row.total, recent: row.recent };
}

/** Nombre d'offres qui ne sont pas encore dans le suivi des candidatures. */
export function untrackedOffresCount(): number {
  syncDuplicates();
  return (
    getDb()
      .prepare(`SELECT COUNT(*) AS c FROM offres o WHERE NOT EXISTS(SELECT 1 FROM candidatures c WHERE c.offre_id = o.id) AND ${VISIBLE_SQL}`)
      .get() as { c: number }
  ).c;
}
