import "server-only";
import { getDb, plainAll } from "./index";

export type CandidatureRow = {
  id: number;
  offre_id: number | null;
  applied_at: string;
  status: string;
  notes: string | null;
  contact: string | null;
  deadline: string | null;
  cv_doc_id: number | null;
  lm_doc_id: number | null;
  msg_doc_id: number | null;
  ext_company: string | null;
  ext_title: string | null;
  ext_country: string | null;
  ext_url: string | null;
  ext_score: number | null;
};

export type CandidatureWithOffre = CandidatureRow & {
  offre_company: string | null;
  offre_title: string | null;
  offre_country: string | null;
  offre_url: string | null;
  offre_score: number | null;
};

export const STATUS = ["envoyee", "en_cours", "entretien", "refusee", "acceptee"] as const;
export type Status = (typeof STATUS)[number];

export function listCandidatures(): CandidatureWithOffre[] {
  const rows = getDb()
    .prepare(
      `SELECT c.*,
              o.company AS offre_company,
              o.title AS offre_title,
              o.country AS offre_country,
              o.url AS offre_url,
              o.score AS offre_score
       FROM candidatures c
       LEFT JOIN offres o ON o.id = c.offre_id
       ORDER BY c.applied_at DESC`
    )
    .all() as CandidatureWithOffre[];
  return plainAll(rows);
}

export function createCandidature(args: {
  offre_id: number | null;
  cv_doc_id?: number | null;
  lm_doc_id?: number | null;
  msg_doc_id?: number | null;
  status?: Status;
  ext_company?: string | null;
  ext_title?: string | null;
  ext_country?: string | null;
  ext_url?: string | null;
  ext_score?: number | null;
  applied_at?: string | null;
  deadline?: string | null;
  notes?: string | null;
  contact?: string | null;
}): number {
  const db = getDb();
  // De-dup: if a candidature already exists for this offre, return it
  if (args.offre_id) {
    const existing = db.prepare("SELECT id FROM candidatures WHERE offre_id = ?").get(args.offre_id) as
      | { id: number }
      | undefined;
    if (existing) {
      // Update doc references
      db.prepare(
        "UPDATE candidatures SET cv_doc_id = COALESCE(?, cv_doc_id), lm_doc_id = COALESCE(?, lm_doc_id), msg_doc_id = COALESCE(?, msg_doc_id) WHERE id = ?"
      ).run(args.cv_doc_id ?? null, args.lm_doc_id ?? null, args.msg_doc_id ?? null, existing.id);
      return existing.id;
    }
  }
  const res = db
    .prepare(
      `INSERT INTO candidatures (offre_id, applied_at, status, notes, contact, deadline, cv_doc_id, lm_doc_id, msg_doc_id, ext_company, ext_title, ext_country, ext_url, ext_score)
       VALUES (?, COALESCE(?, datetime('now')), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      args.offre_id,
      args.applied_at ?? null,
      args.status ?? "envoyee",
      args.notes ?? null,
      args.contact ?? null,
      args.deadline ?? null,
      args.cv_doc_id ?? null,
      args.lm_doc_id ?? null,
      args.msg_doc_id ?? null,
      args.ext_company ?? null,
      args.ext_title ?? null,
      args.ext_country ?? null,
      args.ext_url ?? null,
      args.ext_score ?? null
    );
  return Number(res.lastInsertRowid);
}

// Seules ces colonnes sont modifiables via l'API — empêche le mass-assignment
// (injection de nom de colonne / écriture de champs non prévus).
const UPDATABLE_COLUMNS = ["status", "notes", "contact", "deadline"] as const;

export function updateCandidature(
  id: number,
  patch: Partial<{ status: Status; notes: string; contact: string; deadline: string }>
) {
  const fields: string[] = [];
  const params: any[] = [];
  for (const col of UPDATABLE_COLUMNS) {
    if (Object.prototype.hasOwnProperty.call(patch, col)) {
      fields.push(`${col} = ?`);
      params.push((patch as Record<string, unknown>)[col] ?? null);
    }
  }
  if (!fields.length) return;
  params.push(id);
  getDb().prepare(`UPDATE candidatures SET ${fields.join(", ")} WHERE id = ?`).run(...params);
}

export function deleteCandidature(id: number) {
  getDb().prepare("DELETE FROM candidatures WHERE id = ?").run(id);
}

export function candidaturesCounts() {
  const db = getDb();
  const rows = db
    .prepare("SELECT status, COUNT(*) AS c FROM candidatures GROUP BY status")
    .all() as { status: string; c: number }[];
  const total = (db.prepare("SELECT COUNT(*) AS c FROM candidatures").get() as { c: number }).c;
  const upcoming = (
    db
      .prepare(
        "SELECT COUNT(*) AS c FROM candidatures WHERE deadline IS NOT NULL AND date(deadline) >= date('now')"
      )
      .get() as { c: number }
  ).c;
  return { total, upcoming, byStatus: rows };
}
