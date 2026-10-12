import "server-only";
import { asJson, getDb, parseJson, transaction } from "@/lib/db";
import { assessQuality, type QualityIssue } from "./quality";

type Row = {
  id: number;
  title: string;
  company: string | null;
  location: string | null;
  posted_at: string | null;
  description_text: string;
  description_html: string;
  description_status: "ok" | "partial" | "failed";
  quality_issues: string | null;
};

/**
 * Applique le contrôle de qualité aux offres déjà en base : celles collectées
 * avant lui, ou dont le contrôle a changé depuis. Ne relève jamais un statut —
 * seul un nouveau passage de la source peut rendre « ok » une description
 * qu'elle aurait corrigée.
 */
export function recheckStoredQuality(): { checked: number; changed: number } {
  const db = getDb();
  const rows = db
    .prepare(
      "SELECT id, title, company, location, posted_at, description_text, description_html, description_status, quality_issues FROM offres"
    )
    .all() as Row[];
  const update = db.prepare(
    "UPDATE offres SET description_status = ?, description_text = ?, description_html = ?, quality_issues = ? WHERE id = ?"
  );
  let changed = 0;
  transaction(() => {
    for (const r of rows) {
      const q = assessQuality({ ...r });
      // Un texte parasite déjà retiré ne se voit plus : la mention est conservée,
      // sans quoi chaque passage réécrirait l'offre.
      const before = parseJson<QualityIssue[]>(r.quality_issues, []);
      if (before.includes("texte_parasite") && !q.issues.includes("texte_parasite")) q.issues.splice(0, 0, "texte_parasite");
      const issues = q.issues.length ? asJson(q.issues) : null;
      if (
        q.status !== r.description_status ||
        q.description_text !== r.description_text ||
        q.description_html !== r.description_html ||
        issues !== r.quality_issues
      ) {
        update.run(q.status, q.description_text, q.description_html, issues, r.id);
        changed++;
      }
    }
  });
  return { checked: rows.length, changed };
}

/** Compteurs de problèmes d'un lot d'offres, pour le journal du scan. */
export function countIssues(lists: QualityIssue[][]): Partial<Record<QualityIssue, number>> {
  const counts: Partial<Record<QualityIssue, number>> = {};
  for (const list of lists) for (const i of list) counts[i] = (counts[i] ?? 0) + 1;
  return counts;
}
