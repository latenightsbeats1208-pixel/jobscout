import "server-only";
import { getDb, asJson, parseJson } from "./index";
import type { ScrapedOffre } from "@/lib/scrapers/base";
import type { ScoreResult } from "@/lib/ai/score-offre";
import { classifyContract, type ContractCategory } from "@/lib/contracts";

export type { ScrapedOffre };

export type OffreRow = {
  id: number;
  source: string;
  source_id: string;
  url: string;
  title: string;
  company: string;
  country: string | null;
  location: string | null;
  contract_type: string | null;
  salary: string | null;
  description_html: string;
  description_text: string;
  description_status: "ok" | "failed" | "partial";
  posted_at: string | null;
  scraped_at: string;
  score: number;
  score_breakdown: {
    sector: number;
    skills: number;
    country: number;
    language?: number;
    duration?: number;
    contract?: number;
    reason?: string;
  } | null;
  is_vie: number;
  raw_payload: string | null;
  scrape_errors: string | null;
};

export type OffreFiltered = OffreRow & {
  has_cv: boolean;
  has_lm: boolean;
  has_msg: boolean;
  contract_category: ContractCategory;
};

// Filet de sécurité anti-mojibake : répare l'UTF-8 double-décodé (é→Ã©, ’→â€™…)
// quelle que soit la source. Signatures fiables uniquement — "Ã" suivi d'un
// caractère de continuation n'existe pas en français légitime.
const MOJIBAKE_RE = /Ã[©¨§ª«»¢€‚„¯´¹]|â€™|â€“|â€œ|â€|Ã‰|Ã€|Ã‡|Ã”|Ã‚|Â[«»°€œ]/;

export function fixMojibake(s: string | null): string | null {
  if (!s || !MOJIBAKE_RE.test(s)) return s;
  try {
    const repaired = Buffer.from(s, "latin1").toString("utf8");
    // On n'accepte la réparation que si elle n'introduit pas de caractère de
    // remplacement (perte) et qu'elle réduit bien les signatures mojibake.
    if (!repaired.includes("�") && !MOJIBAKE_RE.test(repaired)) return repaired;
  } catch {}
  return s;
}

export function upsertOffreFromSource(source: string, o: ScrapedOffre): number {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO offres (source, source_id, url, title, company, country, location, contract_type, salary,
      description_html, description_text, description_status, posted_at, is_vie, raw_payload, scrape_errors)
    VALUES (@source, @source_id, @url, @title, @company, @country, @location, @contract_type, @salary,
      @description_html, @description_text, @description_status, @posted_at, @is_vie, @raw_payload, @scrape_errors)
    ON CONFLICT(source, source_id) DO UPDATE SET
      url = excluded.url,
      title = excluded.title,
      company = excluded.company,
      country = excluded.country,
      location = excluded.location,
      contract_type = excluded.contract_type,
      salary = excluded.salary,
      description_html = excluded.description_html,
      description_text = excluded.description_text,
      description_status = excluded.description_status,
      posted_at = excluded.posted_at,
      is_vie = excluded.is_vie,
      raw_payload = excluded.raw_payload,
      scrape_errors = excluded.scrape_errors,
      scraped_at = datetime('now')
  `);
  stmt.run({
    source,
    source_id: o.source_id,
    url: o.url,
    title: fixMojibake(o.title) ?? o.title,
    company: fixMojibake(o.company) ?? o.company,
    country: fixMojibake(o.country),
    location: fixMojibake(o.location),
    contract_type: fixMojibake(o.contract_type),
    salary: fixMojibake(o.salary),
    description_html: fixMojibake(o.description_html) ?? o.description_html,
    description_text: fixMojibake(o.description_text) ?? o.description_text,
    description_status: o.description_status,
    posted_at: o.posted_at,
    is_vie: o.is_vie ? 1 : 0,
    raw_payload: asJson(o.raw_payload),
    scrape_errors: o.scrape_errors ?? null,
  });
  const row = db
    .prepare("SELECT id FROM offres WHERE source = ? AND source_id = ?")
    .get(source, o.source_id) as { id: number } | undefined;
  return row?.id ?? 0;
}

export function setOffreScore(id: number, score: ScoreResult) {
  getDb()
    .prepare("UPDATE offres SET score = ?, score_breakdown = ? WHERE id = ?")
    .run(score.score, asJson({ ...score.breakdown, reason: score.reason }), id);
}

export function listOffres(opts?: {
  country?: string;
  source?: string;
  vieOnly?: boolean;
  minScore?: number;
}): OffreFiltered[] {
  const db = getDb();
  const conds: string[] = [];
  const params: any[] = [];
  if (opts?.country) {
    conds.push("country = ?");
    params.push(opts.country);
  }
  if (opts?.source) {
    conds.push("source = ?");
    params.push(opts.source);
  }
  if (opts?.vieOnly) conds.push("is_vie = 1");
  if (opts?.minScore != null) {
    conds.push("score >= ?");
    params.push(opts.minScore);
  }
  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
  const rows = db
    .prepare(
      `SELECT o.*,
        EXISTS(SELECT 1 FROM documents WHERE offre_id = o.id AND type = 'cv') AS has_cv,
        EXISTS(SELECT 1 FROM documents WHERE offre_id = o.id AND type = 'lm') AS has_lm,
        EXISTS(SELECT 1 FROM documents WHERE offre_id = o.id AND type = 'msg') AS has_msg
       FROM offres o
       ${where}
       ORDER BY
         -- Pertinence = score + bonus de fraîcheur LÉGER. L'ancien tri mettait
         -- TOUT ce qui était daté du jour au-dessus du reste : la seule source
         -- qui date ses offres quotidiennement (APEC) occupait mécaniquement
         -- le haut de liste, quel que soit son score.
         score + CASE
           WHEN posted_at IS NULL THEN 0
           WHEN julianday('now') - julianday(posted_at) <= 1 THEN 6
           WHEN julianday('now') - julianday(posted_at) <= 3 THEN 4
           WHEN julianday('now') - julianday(posted_at) <= 7 THEN 2
           ELSE 0
         END DESC,
         score DESC,
         posted_at DESC`
    )
    .all(...params) as any[];

  return rows.map((r) => ({
    ...r,
    score_breakdown: parseJson(r.score_breakdown, null),
    has_cv: !!r.has_cv,
    has_lm: !!r.has_lm,
    has_msg: !!r.has_msg,
    contract_category: classifyContract({
      contract_type: r.contract_type,
      title: r.title,
      description_text: r.description_text,
      is_vie: r.is_vie,
      source: r.source,
      url: r.url,
    }),
  }));
}

export function getOffre(id: number): OffreFiltered | null {
  const db = getDb();
  const r = db
    .prepare(
      `SELECT o.*,
        EXISTS(SELECT 1 FROM documents WHERE offre_id = o.id AND type = 'cv') AS has_cv,
        EXISTS(SELECT 1 FROM documents WHERE offre_id = o.id AND type = 'lm') AS has_lm,
        EXISTS(SELECT 1 FROM documents WHERE offre_id = o.id AND type = 'msg') AS has_msg
       FROM offres o WHERE id = ?`
    )
    .get(id) as any;
  if (!r) return null;
  return {
    ...r,
    score_breakdown: parseJson(r.score_breakdown, null),
    has_cv: !!r.has_cv,
    has_lm: !!r.has_lm,
    has_msg: !!r.has_msg,
    contract_category: classifyContract({
      contract_type: r.contract_type,
      title: r.title,
      description_text: r.description_text,
      is_vie: r.is_vie,
      source: r.source,
      url: r.url,
    }),
  };
}

export function offresCounts() {
  const db = getDb();
  const total = (db.prepare("SELECT COUNT(*) as c FROM offres").get() as { c: number }).c;
  const today = (
    db.prepare("SELECT COUNT(*) as c FROM offres WHERE date(posted_at) = date('now')").get() as {
      c: number;
    }
  ).c;
  const vie = (db.prepare("SELECT COUNT(*) as c FROM offres WHERE is_vie = 1").get() as { c: number }).c;
  return { total, today, vie };
}
