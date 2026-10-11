import "server-only";
import { getDb, asJson, parseJson } from "./index";
import type { ScrapedOffre } from "@/lib/scrapers/base";
import type { ScoreResult } from "@/lib/scoring/local";
import type { AiReview } from "@/lib/scoring/review";
import type { FeedbackVerdict, OfferFeedback } from "@/lib/feedback";
import { classifyContract, CONTRACT_ORDER, type ContractCategory } from "@/lib/contracts";

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
    /** Proximité de l'intitulé avec les postes visés (absent des notes antérieures). */
    title?: number;
    /** Adéquation de l'expérience demandée (absent des notes antérieures). */
    seniority?: number;
    /** Motif d'exclusion : l'offre est hors critères. */
    excluded?: string;
    /** Verdict de la relecture par l'IA, quand elle a eu lieu. */
    ai_verdict?: string;
    reason?: string;
  } | null;
  /** Relecture par l'IA (exigences indispensables couvertes ou non), ou null. */
  ai_review: AiReview | null;
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

export type OffreSummary = Pick<
  OffreFiltered,
  "id" | "source" | "url" | "title" | "company" | "country" | "location" |
  "posted_at" | "score" | "is_vie" | "description_status" | "contract_category" |
  "has_cv" | "has_lm"
> & {
  description_text: string;
  score_reason: string | null;
  /** Avis de l'utilisateur (👍 / 👎), ou null. */
  feedback: OfferFeedback | null;
};

export type OffersSort = "smart" | "newest" | "oldest" | "score";

export type OffersSearch = {
  offers: OffreSummary[];
  total: number;
  pageSize: number;
  facets: {
    total: number;
    countries: string[];
    sources: string[];
    contractCounts: Record<ContractCategory, number>;
    hasVie: boolean;
  };
};

const OFFER_PAGE_SIZE = 24;
// Même classement pour la liste, l’API paginée et les suggestions de l’accueil.
// Le bonus de fraîcheur reste volontairement léger face au score du profil.
// Départage final par id : sans lui, l’ordre des ex æquo dépend du plan de
// requête et « Afficher davantage » peut répéter ou sauter des offres.
const SMART_ORDER = `score + CASE
  WHEN posted_at IS NULL THEN 0
  WHEN julianday('now') - julianday(posted_at) <= 1 THEN 6
  WHEN julianday('now') - julianday(posted_at) <= 3 THEN 4
  WHEN julianday('now') - julianday(posted_at) <= 7 THEN 2
  ELSE 0
END DESC, score DESC, posted_at DESC, o.id DESC`;

function normalizeSearch(value: string): string {
  return value.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
}

// ----------- Cache mémoire de la recherche -----------
// Sans cache, chaque requête relisait les 4 623 lignes, reclassait chaque contrat
// (normalisation des descriptions) et, avec un mot-clé, renormalisait 14 Mo de
// texte : ~250 ms par clic de filtre, ~600 ms par recherche. Les lignes prêtes à
// filtrer restent en mémoire et sont reconstruites dès que la base change.

type CachedOffre = Omit<OffreSummary, "description_text" | "score_reason"> & {
  /** 1 000 premiers caractères : tout ce que l’aperçu affiche. */
  excerpt: string;
  /** JSON brut, lu seulement pour les offres de la page renvoyée. */
  score_breakdown: string | null;
};

type OffresCache = {
  fingerprint: string;
  byId: Map<number, CachedOffre>;
  /** Ordre SMART_ORDER, relu chaque minute (le bonus de fraîcheur dépend de l’heure). */
  smart: CachedOffre[];
  orderedAt: number;
  /** Titre, entreprise, pays, lieu et description complète, sans accents ; construit à la première recherche. */
  haystacks: Map<number, string> | null;
  facets: OffersSearch["facets"];
};

const ORDER_TTL_MS = 60_000;
let offresCache: OffresCache | null = null;

/**
 * Empreinte de la base, lue à chaque appel (deux lectures de quelques microsecondes) :
 * - `PRAGMA data_version` change dès qu’une AUTRE connexion valide une écriture
 *   (autre instance du module, script de scan quotidien, autre processus) ;
 * - `total_changes()` compte les lignes écrites par CETTE connexion (scan, re-score,
 *   documents générés, suppressions…), y compris les écritures sans date comme le re-score.
 * Toute écriture invalide donc le cache ; aucune ne peut le laisser périmé.
 */
function dbFingerprint(): string {
  const db = getDb();
  const version = (db.prepare("PRAGMA data_version").get() as { data_version: number }).data_version;
  const changes = (db.prepare("SELECT total_changes() AS n").get() as { n: number }).n;
  return `${version}:${changes}`;
}

type CacheRow = Pick<
  OffreRow,
  "id" | "source" | "url" | "title" | "company" | "country" | "location" |
  "contract_type" | "description_status" | "posted_at" | "score" | "is_vie"
> & {
  head: string | null; excerpt: string | null; score_breakdown: string | null; has_cv: number; has_lm: number;
  feedback_verdict: FeedbackVerdict | null; feedback_reason: string | null;
};

function buildOffresCache(fingerprint: string): OffresCache {
  // La description entière ne remonte pas : 4 000 caractères suffisent à classer le
  // contrat (detectVie en lit 4 000, classifyContract 1 500 ; résultat identique sur
  // les 4 623 offres de référence) et l’aperçu en affiche 1 000.
  const rows = getDb().prepare(`
    SELECT o.id, o.source, o.url, o.title, o.company, o.country, o.location,
      o.contract_type, o.description_status, o.posted_at, o.score, o.score_breakdown, o.is_vie,
      substr(o.description_text, 1, 4000) AS head,
      substr(o.description_text, 1, 1000) AS excerpt,
      EXISTS(SELECT 1 FROM documents WHERE offre_id = o.id AND type = 'cv') AS has_cv,
      EXISTS(SELECT 1 FROM documents WHERE offre_id = o.id AND type = 'lm') AS has_lm,
      f.verdict AS feedback_verdict, f.reason AS feedback_reason
    FROM offres o LEFT JOIN offre_feedback f ON f.offre_id = o.id
    -- Une offre jugée « pas pour moi » descend en fin de liste, sans disparaître.
    ORDER BY (f.verdict = 'down') ASC, ${SMART_ORDER}
  `).all() as CacheRow[];

  const contractCounts = Object.fromEntries(CONTRACT_ORDER.map((contract) => [contract, 0])) as Record<ContractCategory, number>;
  const countries = new Set<string>();
  const sources = new Set<string>();
  const byId = new Map<number, CachedOffre>();
  const smart: CachedOffre[] = [];
  for (const row of rows) {
    const contract_category = classifyContract({ ...row, description_text: row.head ?? "" });
    contractCounts[contract_category]++;
    if (row.country) countries.add(row.country);
    sources.add(row.source);
    const offer: CachedOffre = {
      id: row.id, source: row.source, url: row.url, title: row.title,
      company: row.company, country: row.country, location: row.location,
      posted_at: row.posted_at, score: row.score, is_vie: row.is_vie,
      description_status: row.description_status, contract_category,
      has_cv: !!row.has_cv, has_lm: !!row.has_lm,
      feedback: row.feedback_verdict ? { verdict: row.feedback_verdict, reason: row.feedback_reason } : null,
      // substr() compte des caractères, slice() des unités UTF-16 (émojis) : on
      // recoupe pour rendre exactement l’extrait d’avant.
      excerpt: (row.excerpt ?? "").slice(0, 1000), score_breakdown: row.score_breakdown,
    };
    byId.set(offer.id, offer);
    smart.push(offer);
  }
  return {
    fingerprint, byId, smart, orderedAt: Date.now(), haystacks: null,
    facets: {
      total: rows.length,
      countries: [...countries].sort((a, b) => a.localeCompare(b, "fr")),
      sources: [...sources].sort(),
      contractCounts,
      hasVie: contractCounts.vie > 0,
    },
  };
}

function getOffresCache(): OffresCache {
  const fingerprint = dbFingerprint();
  if (!offresCache || offresCache.fingerprint !== fingerprint) {
    offresCache = buildOffresCache(fingerprint);
  } else if (Date.now() - offresCache.orderedAt > ORDER_TTL_MS) {
    // Seul l’ordre bouge avec l’heure : on relit les identifiants triés, pas les lignes.
    const cache = offresCache;
    const ids = getDb().prepare(`SELECT o.id FROM offres o ORDER BY ${SMART_ORDER}`).all() as { id: number }[];
    cache.smart = ids.map(({ id }) => cache.byId.get(id)).filter((offer): offer is CachedOffre => !!offer);
    cache.orderedAt = Date.now();
  }
  return offresCache;
}

function getHaystacks(cache: OffresCache): Map<number, string> {
  if (cache.haystacks) return cache.haystacks;
  const rows = getDb().prepare(
    "SELECT id, title, company, country, location, description_text FROM offres"
  ).all() as Pick<OffreRow, "id" | "title" | "company" | "country" | "location" | "description_text">[];
  const haystacks = new Map<number, string>();
  for (const row of rows) {
    haystacks.set(row.id, normalizeSearch([row.title, row.company, row.country, row.location, row.description_text].filter(Boolean).join(" ")));
  }
  cache.haystacks = haystacks;
  return haystacks;
}

/** Comparaison binaire, comme ORDER BY sur du texte en SQLite (pas de collation locale). */
function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Seuil de score lu dans une URL (?score=70, ?minScore=60) : entier de 1 à 100, sinon aucun filtre. */
export function parseMinScore(raw: string | null | undefined): number {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 && n <= 100 ? n : 0;
}

/** Filtrage côté serveur : seules les cartes de la page courante sont envoyées au navigateur. */
export function searchOffres(opts: {
  query?: string;
  source?: string;
  country?: string;
  contracts?: ContractCategory[];
  /** Score minimal (true = 60, seuil de la puce « Score 60+ »). */
  minScore?: boolean | number;
  /** Raccourci de ?vie=1 : même règle que la puce contrat « V.I.E » (contract_category). */
  vieOnly?: boolean;
  sortBy?: OffersSort;
  page?: number;
} = {}): OffersSearch {
  const cache = getOffresCache();
  const query = normalizeSearch((opts.query ?? "").trim());
  const haystacks = query ? getHaystacks(cache) : null;
  const contracts = new Set(opts.contracts ?? []);
  const minScore = opts.minScore === true ? 60 : typeof opts.minScore === "number" ? opts.minScore : 0;
  const filtered = cache.smart.filter((row) => {
    if (haystacks && !(haystacks.get(row.id) ?? "").includes(query)) return false;
    if (opts.source && row.source !== opts.source) return false;
    if (opts.country && row.country !== opts.country) return false;
    if (contracts.size && !contracts.has(row.contract_category)) return false;
    if (minScore > 0 && (row.score ?? 0) < minScore) return false;
    if (opts.vieOnly && row.contract_category !== "vie") return false;
    return true;
  });

  // Tris stables : les ex æquo gardent l’ordre intelligent, lui-même départagé par id.
  // Un 👎 reste en fin de liste quel que soit le tri par score.
  const down = (o: CachedOffre) => Number(o.feedback?.verdict === "down");
  if (opts.sortBy === "score") filtered.sort((a, b) => down(a) - down(b) || (b.score ?? 0) - (a.score ?? 0));
  if (opts.sortBy === "newest") filtered.sort((a, b) => compareText(b.posted_at ?? "", a.posted_at ?? ""));
  if (opts.sortBy === "oldest") {
    // Dates inconnues en fin de liste, comme en 3.4.10.
    filtered.sort((a, b) => {
      if (!a.posted_at || !b.posted_at) return Number(!a.posted_at) - Number(!b.posted_at);
      return compareText(a.posted_at, b.posted_at);
    });
  }
  const page = Math.max(1, Math.min(10000, Math.trunc(opts.page ?? 1) || 1));
  const visible = filtered.slice((page - 1) * OFFER_PAGE_SIZE, page * OFFER_PAGE_SIZE);
  return {
    offers: visible.map((row) => ({
      id: row.id, source: row.source, url: row.url, title: row.title,
      company: row.company, country: row.country, location: row.location,
      posted_at: row.posted_at, score: row.score, is_vie: row.is_vie,
      description_status: row.description_status,
      description_text: row.excerpt,
      score_reason: parseJson<{ reason?: string } | null>(row.score_breakdown, null)?.reason ?? null,
      contract_category: row.contract_category,
      has_cv: row.has_cv, has_lm: row.has_lm,
      feedback: row.feedback,
    })),
    total: filtered.length,
    pageSize: OFFER_PAGE_SIZE,
    facets: cache.facets,
  };
}

/** Les six premières suggestions suffisent au tableau de bord. */
export function suggestedOffres(limit: number, untracked = false): Pick<OffreRow, "id" | "title" | "company" | "country" | "location" | "posted_at" | "score">[] {
  return getDb().prepare(`
    SELECT o.id, o.title, o.company, o.country, o.location, o.posted_at, o.score
    FROM offres o
    -- Une offre jugée « pas pour moi » n'est jamais suggérée.
    WHERE NOT EXISTS(SELECT 1 FROM offre_feedback f WHERE f.offre_id = o.id AND f.verdict = 'down')
    ${untracked ? "AND NOT EXISTS(SELECT 1 FROM candidatures c WHERE c.offre_id = o.id)" : ""}
    ORDER BY ${SMART_ORDER} LIMIT ?
  `).all(Math.max(1, Math.min(20, Math.trunc(limit)))) as Pick<OffreRow, "id" | "title" | "company" | "country" | "location" | "posted_at" | "score">[];
}

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

/** Une note et son détail, quelle que soit la version de la note qui l'a produite. */
export type StoredScore = Pick<ScoreResult, "score" | "reason"> & { breakdown: object };

export function setOffreScore(id: number, score: StoredScore) {
  getDb()
    .prepare("UPDATE offres SET score = ?, score_breakdown = ? WHERE id = ?")
    .run(score.score, asJson({ ...score.breakdown, reason: score.reason }), id);
}

export function setOffreReview(id: number, review: AiReview) {
  getDb().prepare("UPDATE offres SET ai_review = ? WHERE id = ?").run(asJson(review), id);
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
       ORDER BY ${SMART_ORDER}`
    )
    .all(...params) as any[];

  return rows.map((r) => ({
    ...r,
    score_breakdown: parseJson(r.score_breakdown, null),
    ai_review: parseJson(r.ai_review, null),
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
    ai_review: parseJson(r.ai_review, null),
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
  // Colonne is_vie figée au scan : pour un chiffre qui corresponde à /offres?vie=1,
  // lire searchOffres().facets.contractCounts.vie (page /offres) ou vieFigure() (accueil).
  const vie = (db.prepare("SELECT COUNT(*) as c FROM offres WHERE is_vie = 1").get() as { c: number }).c;
  return { total, today, vie };
}
