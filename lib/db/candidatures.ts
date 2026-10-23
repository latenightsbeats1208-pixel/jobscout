import "server-only";
import { getDb, plainAll } from "./index";
import { ensureOffresRepaired } from "./repair-markup";

export type CandidatureRow = {
  id: number;
  offre_id: number | null;
  applied_at: string;
  status: string;
  notes: string | null;
  contact: string | null;
  deadline: string | null;
  follow_up_date: string | null;
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
  // Titres et entreprises lus dans offres sans passer par lib/db/offres.ts : réparations
  // uniques des offres d'abord (page Candidatures, export, API), sans coût ensuite.
  ensureOffresRepaired();
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
  follow_up_date?: string | null;
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
      `INSERT INTO candidatures (offre_id, applied_at, status, notes, contact, deadline, follow_up_date, cv_doc_id, lm_doc_id, msg_doc_id, ext_company, ext_title, ext_country, ext_url, ext_score)
       VALUES (?, COALESCE(?, datetime('now')), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      args.offre_id,
      args.applied_at ?? null,
      args.status ?? "envoyee",
      args.notes ?? null,
      args.contact ?? null,
      args.deadline ?? null,
      args.follow_up_date ?? null,
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
const UPDATABLE_COLUMNS = ["status", "notes", "contact", "deadline", "follow_up_date"] as const;

export function updateCandidature(
  id: number,
  patch: Partial<{ status: Status; notes: string; contact: string; deadline: string; follow_up_date: string }>
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
    db.prepare(
      `SELECT COUNT(*) AS c FROM (
         SELECT id FROM candidatures WHERE deadline IS NOT NULL AND date(deadline) >= date('now')
         UNION ALL
         SELECT id FROM candidatures
         WHERE follow_up_date IS NOT NULL
           AND status NOT IN ('acceptee', 'refusee')
           AND date(follow_up_date) >= date('now')
       )`
    ).get() as { c: number }
  ).c;
  return { total, upcoming, byStatus: rows };
}

export type UpcomingDeadline = {
  id: number;
  offre_id: number | null;
  deadline: string;
  status: string;
  kind: "deadline" | "follow_up";
  title: string | null;
  company: string | null;
};

/**
 * Échéances et relances proches, avec l'intitulé de la candidature.
 * Les relances en retard restent visibles tant que la candidature est active.
 */
export function upcomingDeadlines(limit = 5): UpcomingDeadline[] {
  ensureOffresRepaired(); // comme listCandidatures
  const rows = getDb()
    .prepare(
      `SELECT c.id, c.offre_id, c.deadline, c.status, c.kind,
              COALESCE(NULLIF(TRIM(o.title), ''), NULLIF(TRIM(c.ext_title), '')) AS title,
              COALESCE(NULLIF(TRIM(o.company), ''), NULLIF(TRIM(c.ext_company), '')) AS company
       FROM (
         SELECT id, offre_id, deadline, status, 'deadline' AS kind, ext_title, ext_company
         FROM candidatures WHERE deadline IS NOT NULL AND date(deadline) >= date('now')
         UNION ALL
         SELECT id, offre_id, follow_up_date AS deadline, status, 'follow_up' AS kind, ext_title, ext_company
         FROM candidatures
         WHERE follow_up_date IS NOT NULL
           AND status NOT IN ('acceptee', 'refusee')
           AND date(follow_up_date) <= date('now', '+30 days')
       ) c
       LEFT JOIN offres o ON o.id = c.offre_id
       ORDER BY date(c.deadline) ASC, c.id ASC
       LIMIT ?`
    )
    .all(Math.max(1, Math.min(20, Math.trunc(limit)))) as UpcomingDeadline[];
  return plainAll(rows);
}

export type SearchReport = {
  total: number;
  interviews: number;
  responses: number;
  accepted: number;
  refused: number;
  responseRate: number;
};

export function searchReport(days = 30): SearchReport {
  const boundedDays = Math.max(0, Math.min(3650, Math.trunc(days)));
  const where = boundedDays ? "WHERE date(applied_at) >= date('now', ?)" : "";
  const rows = getDb()
    .prepare(`SELECT status, COUNT(*) AS count FROM candidatures ${where} GROUP BY status`)
    .all(...(boundedDays ? [`-${boundedDays} days`] : [])) as { status: string; count: number }[];
  const byStatus = new Map(rows.map((row) => [row.status, row.count]));
  const total = rows.reduce((sum, row) => sum + row.count, 0);
  const interviews = byStatus.get("entretien") ?? 0;
  const accepted = byStatus.get("acceptee") ?? 0;
  const refused = byStatus.get("refusee") ?? 0;
  const responses = interviews + accepted + refused;
  return {
    total,
    interviews,
    responses,
    accepted,
    refused,
    responseRate: total ? Math.round((responses / total) * 100) : 0,
  };
}
