import "server-only";
import { dbFingerprint, getDb, transaction } from "./index";
import { groupDuplicates, shingles, type DedupeCandidate } from "@/lib/scan/dedupe";

type Row = Omit<DedupeCandidate, "activity" | "closed"> & {
  activity: number;
  closed_at: string | null;
  duplicate_of: number | null;
  scraped_at: string;
};

/**
 * Suites de mots des descriptions déjà lues, par offre : le recalcul tourne
 * après chaque écriture, et relire puis découper les textes le faisait passer
 * de 26 à 92 ms sur 1 635 offres. Une offre recollectée change de scraped_at.
 */
const textCache = new Map<number, { stamp: string; set: Set<string> }>();

/**
 * Recalcule les groupes de doublons (colonne duplicate_of). N'écrit que les
 * lignes qui changent : un second appel sur la même base n'écrit rien.
 */
export function refreshDuplicates(): { hidden: number; changed: number } {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT o.id, o.title, o.company, o.country, o.location, o.description_status, o.score, o.posted_at,
         o.closed_at, o.duplicate_of, o.scraped_at,
         (EXISTS(SELECT 1 FROM candidatures c WHERE c.offre_id = o.id)
           OR EXISTS(SELECT 1 FROM documents d WHERE d.offre_id = o.id)
           OR EXISTS(SELECT 1 FROM offre_feedback f WHERE f.offre_id = o.id)) AS activity
       FROM offres o`
    )
    .all() as Row[];
  const text = db.prepare("SELECT description_text FROM offres WHERE id = ?");
  const stamps = new Map(rows.map((r) => [r.id, r.scraped_at]));
  const textOf = (id: number): Set<string> => {
    const stamp = stamps.get(id) ?? "";
    const hit = textCache.get(id);
    if (hit && hit.stamp === stamp) return hit.set;
    const set = shingles((text.get(id) as { description_text: string } | undefined)?.description_text ?? "");
    textCache.set(id, { stamp, set });
    return set;
  };
  const representativeOf = groupDuplicates(
    rows.map((r) => ({ ...r, activity: !!r.activity, closed: !!r.closed_at })),
    textOf
  );
  const update = db.prepare("UPDATE offres SET duplicate_of = ? WHERE id = ?");
  let changed = 0;
  transaction(() => {
    for (const r of rows) {
      const want = representativeOf.get(r.id) ?? null;
      if (want !== r.duplicate_of) {
        update.run(want, r.id);
        changed++;
      }
    }
  });
  return { hidden: representativeOf.size, changed };
}

let syncedAt = "";

/**
 * Groupes à jour avant toute lecture qui en dépend (liste, accueil) : toute
 * écriture peut en changer un — nouvelle offre, note, avis, candidature,
 * document. Ne recalcule que si la base a changé depuis le dernier calcul.
 */
export function syncDuplicates(): void {
  if (dbFingerprint() === syncedAt) return;
  refreshDuplicates();
  syncedAt = dbFingerprint();
}

export type OffreSibling = {
  id: number;
  title: string;
  location: string | null;
  source: string;
  score: number | null;
  closed_at: string | null;
};

/** Les autres publications de la même offre (autres lieux, autres sources). */
export function getOffreSiblings(id: number): OffreSibling[] {
  syncDuplicates();
  const db = getDb();
  const self = db.prepare("SELECT duplicate_of FROM offres WHERE id = ?").get(id) as { duplicate_of: number | null } | undefined;
  if (!self) return [];
  const rep = self.duplicate_of ?? id;
  return db
    .prepare(
      `SELECT id, title, location, source, score, closed_at FROM offres
       WHERE (id = ? OR duplicate_of = ?) AND id != ?
       ORDER BY closed_at IS NOT NULL, score DESC, id`
    )
    .all(rep, rep, id) as OffreSibling[];
}
