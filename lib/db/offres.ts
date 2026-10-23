import "server-only";
import { getDb, asJson, parseJson, getSetting } from "./index";
import { geoGeneration, haversineKm, resolveOfferLocation, type GeoPrecision } from "@/lib/geo";
import { depOfInsee, roundKm } from "@/lib/distance/format";
import type { ScrapedOffre } from "@/lib/scrapers/base";
import type { ScoreResult } from "@/lib/ai/score-offre";
import { classifyContract, CONTRACT_ORDER, type ContractCategory } from "@/lib/contracts";
import { fixMojibake, sanitizeScrapedOffre } from "@/lib/offres/clean-text";
import { ensureOffresRepaired } from "./repair-markup";

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
    matched_sectors?: string[];
    matched_skills?: string[];
    profile_skills_not_in_offer?: string[];
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

export type OffreSummary = Pick<
  OffreFiltered,
  "id" | "source" | "url" | "title" | "company" | "country" | "location" |
  "posted_at" | "score" | "is_vie" | "description_status" | "contract_category" |
  "has_cv" | "has_lm"
> & {
  description_text: string;
  score_reason: string | null;
  /** Distance à vol d'oiseau depuis la ville de référence (km), null si inconnue ou sans ville. */
  distance_km: number | null;
  /** Même commune que la ville de référence (arrondissements de Paris, Lyon, Marseille compris). */
  same_city: boolean;
  /** Lieu connu seulement au département, celui de la ville de référence. */
  same_dept: boolean;
  /** Lieu reconnu (« Saint-Denis (93) », « Bruxelles, Belgique »), ou null. */
  geo_label: string | null;
  geo_precision: GeoPrecision | null;
};

export type OffersSort = "smart" | "newest" | "oldest" | "score" | "distance";

/** Ville de référence du filtre par distance (lib/distance/home.ts), passée par l'appelant. */
export type DistanceOrigin = { code: string; label: string; lat: number; lng: number };

/** Comptes du menu « Distance », calculés sur les offres qui passent les autres filtres. */
export type DistanceFacets = {
  home: { code: string; label: string } | null;
  /** Offres dans chaque rayon (clé = rayon en km, « 0 » = dans la commune). */
  counts: Record<string, number>;
  /** Offres dont on connaît la distance ; offres EN FRANCE dont on ne la connaît pas (lieu absent, région,
   * télétravail). Les offres à l'étranger sans ville ne sont jamais dans un rayon autour d'une ville française. */
  located: number;
  unlocated: number;
};

/** Facettes de toute la base, calculées une fois par construction du cache. */
type BaseFacets = {
  total: number;
  countries: string[];
  sources: string[];
  contractCounts: Record<ContractCategory, number>;
  hasVie: boolean;
};

export type OffersSearch = {
  offers: OffreSummary[];
  total: number;
  pageSize: number;
  facets: BaseFacets & { distance: DistanceFacets };
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

type CachedOffre = Omit<OffreSummary, "description_text" | "score_reason" | "distance_km" | "same_city" | "same_dept"> & {
  /** Lieu non placé mais en France (ou pays inconnu) : candidat à « Les inclure ». */
  geo_unlocated_fr: boolean;
  geo_lat: number | null;
  geo_lng: number | null;
  /** Code INSEE de la commune française reconnue (comparaison « dans votre ville »). */
  geo_code: string | null;
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
  facets: BaseFacets;
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
 * - `geoGeneration()` change quand la base géographique se recharge après une panne :
 *   les positions calculées sur la base vide sont alors refaites.
 */
function dbFingerprint(): string {
  const db = getDb();
  const version = (db.prepare("PRAGMA data_version").get() as { data_version: number }).data_version;
  const changes = (db.prepare("SELECT total_changes() AS n").get() as { n: number }).n;
  return `${version}:${changes}:${geoGeneration()}`;
}

type CacheRow = Pick<
  OffreRow,
  "id" | "source" | "url" | "title" | "company" | "country" | "location" |
  "contract_type" | "description_status" | "posted_at" | "score" | "is_vie"
> & { head: string | null; excerpt: string | null; score_breakdown: string | null; has_cv: number; has_lm: number; geo_hint: unknown; geo_dep: string | null };

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
      -- Indices de lieu propres à la source (lib/geo) : département de l'APEC, télétravail de WTTJ.
      CASE WHEN json_valid(o.raw_payload) THEN CASE o.source
        WHEN 'apec' THEN json_extract(o.raw_payload, '$.lieuTexte')
        WHEN 'wttj' THEN json_extract(o.raw_payload, '$.remote')
      END END AS geo_hint,
      -- France Travail range parfois le département dans le champ entreprise (« 974 »).
      CASE WHEN o.source = 'francetravail' AND (trim(o.company) GLOB '[0-9][0-9]' OR trim(o.company) GLOB '[0-9][0-9][0-9]' OR trim(o.company) IN ('2A', '2B'))
        THEN trim(o.company) END AS geo_dep
    FROM offres o ORDER BY ${SMART_ORDER}
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
    const geo = resolveOfferLocation({
      source: row.source, location: row.location, country: row.country,
      // Indice textuel seulement (une valeur JSON d'un autre type ne doit rien casser).
      hint: row.geo_dep ?? (typeof row.geo_hint === "string" ? row.geo_hint : null),
      head: row.source === "talent" ? (row.head ?? "").slice(0, 400) : null,
    });
    const countryKey = normalizeSearch((row.country ?? "").trim());
    const offer: CachedOffre = {
      id: row.id, source: row.source, url: row.url, title: row.title,
      company: row.company, country: row.country, location: row.location,
      posted_at: row.posted_at, score: row.score, is_vie: row.is_vie,
      description_status: row.description_status, contract_category,
      has_cv: !!row.has_cv, has_lm: !!row.has_lm,
      // substr() compte des caractères, slice() des unités UTF-16 (émojis) : on
      // recoupe pour rendre exactement l’extrait d’avant.
      excerpt: (row.excerpt ?? "").slice(0, 1000), score_breakdown: row.score_breakdown,
      geo_lat: geo.lat, geo_lng: geo.lng, geo_code: geo.lat !== null ? geo.code ?? null : null,
      geo_label: geo.label, geo_precision: geo.precision,
      geo_unlocated_fr: geo.lat === null && (geo.country ? geo.country === "FR" : countryKey === "" || countryKey === "france"),
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
  // Réparations uniques des offres déjà en base (entités HTML, puis balisage en
  // clair), avant toute lecture : un serveur déjà lancé les fait à la première
  // requête. L'empreinte suffirait à reconstruire le cache après leurs UPDATE ; on le vide
  // aussi explicitement.
  if (ensureOffresRepaired() > 0) offresCache = null;
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

/** Rayons du menu « Distance » (km) ; 0 = dans la commune. Même liste que lib/distance/format.ts. */
const DISTANCE_BUCKETS = [0, 5, 10, 20, 30, 50, 100, 200] as const;

/** Arrondissements de Paris, Lyon et Marseille → commune entière. */
function cityCodeOf(code: string | null | undefined): string | null {
  if (!code) return null;
  if (/^751\d\d$/.test(code)) return "75056";
  if (/^6938\d$/.test(code)) return "69123";
  if (/^132\d\d$/.test(code)) return "13055";
  return code;
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
  /** Restreint aux offres nouvellement découvertes lors du dernier scan. */
  newOnly?: boolean;
  sortBy?: OffersSort;
  /** Ville de référence (lib/distance/home.ts) : sans elle, ni distance, ni rayon, ni tri par distance. */
  home?: DistanceOrigin | null;
  /** Rayon en km (0 = dans la commune) ; absent = toutes distances. */
  radiusKm?: number | null;
  /** Avec un rayon : garder aussi les offres dont la distance est inconnue. */
  includeUnlocated?: boolean;
  page?: number;
} = {}): OffersSearch {
  const cache = getOffresCache();
  const query = normalizeSearch((opts.query ?? "").trim());
  const haystacks = query ? getHaystacks(cache) : null;
  const contracts = new Set(opts.contracts ?? []);
  const newIds = opts.newOnly
    ? new Set(
        parseJson<unknown[]>(getSetting("last_scan_new_offer_ids"), [])
          .filter((id): id is number => typeof id === "number" && Number.isSafeInteger(id) && id > 0)
      )
    : null;
  const minScore = opts.minScore === true ? 60 : typeof opts.minScore === "number" ? opts.minScore : 0;
  const filtered = cache.smart.filter((row) => {
    if (haystacks && !(haystacks.get(row.id) ?? "").includes(query)) return false;
    if (opts.source && row.source !== opts.source) return false;
    if (newIds && !newIds.has(row.id)) return false;
    if (opts.country && row.country !== opts.country) return false;
    if (contracts.size && !contracts.has(row.contract_category)) return false;
    if (minScore > 0 && (row.score ?? 0) < minScore) return false;
    if (opts.vieOnly && row.contract_category !== "vie") return false;
    return true;
  });

  // Distance : calculée à la volée depuis la ville de référence, à chaque requête
  // (positions des offres prêtes dans le cache), jamais enregistrée ni intégrée au score.
  const home = opts.home ?? null;
  const homeCity = home ? cityCodeOf(home.code) : null;
  const distances = new Map<number, number | null>();
  const sameCity = new Set<number>();
  const sameDept = new Set<number>();
  const homeDept = home ? depOfInsee(home.code) : null;
  let unlocatedFr = 0;
  const counts: Record<string, number> = Object.fromEntries(DISTANCE_BUCKETS.map((radius) => [String(radius), 0]));
  let located = 0;
  if (home) {
    for (const row of filtered) {
      if (row.geo_lat === null || row.geo_lng === null) {
        distances.set(row.id, null);
        if (row.geo_unlocated_fr) unlocatedFr++;
        continue;
      }
      const km = haversineKm(home, { lat: row.geo_lat, lng: row.geo_lng });
      distances.set(row.id, km);
      located++;
      const same = !!homeCity && cityCodeOf(row.geo_code) === homeCity;
      if (same) sameCity.add(row.id);
      else if (row.geo_precision === "departement" && row.geo_code === homeDept) sameDept.add(row.id);
      // Chaque rayon contient la ville (arrondissements dont le centre est à 6 km du centre de Paris)
      // et compare la distance AFFICHÉE (arrondie), pour que ce qui est écrit et ce qui est filtré concordent.
      for (const radius of DISTANCE_BUCKETS) {
        if (same || (radius > 0 && roundKm(km) <= radius)) counts[String(radius)]++;
      }
    }
  }
  const radius = home && typeof opts.radiusKm === "number" && opts.radiusKm >= 0 ? opts.radiusKm : null;
  const inRadius = radius === null ? filtered : filtered.filter((row) => {
    const km = distances.get(row.id);
    if (km === null || km === undefined) return !!opts.includeUnlocated && row.geo_unlocated_fr;
    return sameCity.has(row.id) || (radius > 0 && roundKm(km) <= radius);
  });

  // Tris stables : les ex æquo gardent l’ordre intelligent, lui-même départagé par id.
  if (opts.sortBy === "distance" && home) {
    // Distances inconnues en fin de liste ; les nombreuses offres d'une même ville sont au
    // même point : l'ordre intelligent les départage, sans quoi « Afficher davantage »
    // répéterait des offres.
    // « Dans votre ville » d'abord (un arrondissement peut être à 6 km du centre de la ville),
    // puis les distances : une offre connue au seul département ne s'intercale pas dans la ville.
    inRadius.sort((a, b) => {
      const sa = sameCity.has(a.id);
      const sb = sameCity.has(b.id);
      if (sa || sb) return Number(sb) - Number(sa);
      const da = distances.get(a.id) ?? null;
      const db = distances.get(b.id) ?? null;
      if (da === null || db === null) return Number(da === null) - Number(db === null);
      return da - db;
    });
  }
  if (opts.sortBy === "score") inRadius.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  if (opts.sortBy === "newest") inRadius.sort((a, b) => compareText(b.posted_at ?? "", a.posted_at ?? ""));
  if (opts.sortBy === "oldest") {
    // Dates inconnues en fin de liste, comme en 3.4.10.
    inRadius.sort((a, b) => {
      if (!a.posted_at || !b.posted_at) return Number(!a.posted_at) - Number(!b.posted_at);
      return compareText(a.posted_at, b.posted_at);
    });
  }
  const page = Math.max(1, Math.min(10000, Math.trunc(opts.page ?? 1) || 1));
  const visible = inRadius.slice((page - 1) * OFFER_PAGE_SIZE, page * OFFER_PAGE_SIZE);
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
      distance_km: distances.get(row.id) ?? null,
      same_city: sameCity.has(row.id),
      same_dept: sameDept.has(row.id),
      geo_label: row.geo_label, geo_precision: row.geo_precision,
    })),
    total: inRadius.length,
    pageSize: OFFER_PAGE_SIZE,
    // Pays, sources et contrats de toute la base ; comptes du menu « Distance » sur les offres filtrées.
    facets: {
      ...cache.facets,
      distance: {
        home: home ? { code: home.code, label: home.label } : null,
        counts, located, unlocated: home ? unlocatedFr : 0,
      },
    },
  };
}

/** Les six premières suggestions suffisent au tableau de bord. */
export function suggestedOffres(limit: number, untracked = false): Pick<OffreRow, "id" | "title" | "company" | "country" | "location" | "posted_at" | "score">[] {
  // Lecture directe de la base (sans le cache) : les réparations uniques passent d'abord,
  // comme pour les autres lectures.
  ensureOffresRepaired();
  return getDb().prepare(`
    SELECT o.id, o.title, o.company, o.country, o.location, o.posted_at, o.score
    FROM offres o
    ${untracked ? "WHERE NOT EXISTS(SELECT 1 FROM candidatures c WHERE c.offre_id = o.id)" : ""}
    ORDER BY ${SMART_ORDER} LIMIT ?
  `).all(Math.max(1, Math.min(20, Math.trunc(limit)))) as Pick<OffreRow, "id" | "title" | "company" | "country" | "location" | "posted_at" | "score">[];
}

// Filet de nettoyage (entités HTML, mojibake) : lib/offres/clean-text.ts. fixMojibake
// reste exporté d'ici pour les appelants existants.
export { fixMojibake };

export function upsertOffreFromSource(source: string, o: ScrapedOffre): number {
  // Réparations des offres déjà en base AVANT la première écriture du nouveau code
  // (un scan lancé avant toute page ouverte) : sinon elles repasseraient sur des textes déjà
  // nettoyés par le filet, et le décodage n'est pas idempotent.
  ensureOffresRepaired();
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
  // Un seul passage du filet par offre scrapée : le décodage d'entités n'est pas
  // idempotent (« &amp;lt; » → « &lt; » → « < »).
  const c = sanitizeScrapedOffre(o, source);
  stmt.run({
    source,
    source_id: c.source_id,
    url: c.url,
    title: c.title,
    company: c.company,
    country: c.country,
    location: c.location,
    contract_type: c.contract_type,
    salary: c.salary,
    description_html: c.description_html,
    description_text: c.description_text,
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

export function newOffersFromLastScan(limit = 6): OffreSummary[] {
  const ids = parseJson<unknown[]>(getSetting("last_scan_new_offer_ids"), [])
    .filter((id): id is number => typeof id === "number" && Number.isSafeInteger(id) && id > 0);
  if (!ids.length) return [];
  const bounded = Math.max(1, Math.min(20, Math.trunc(limit)));
  const placeholders = ids.map(() => "?").join(",");
  const rows = getDb()
    .prepare(
      `SELECT o.id, o.source, o.url, o.title, o.company, o.country, o.location,
              o.posted_at, o.score, o.is_vie, o.description_status,
              o.score_breakdown, o.description_text, o.contract_type,
              EXISTS(SELECT 1 FROM documents WHERE offre_id = o.id AND type = 'cv') AS has_cv,
              EXISTS(SELECT 1 FROM documents WHERE offre_id = o.id AND type = 'lm') AS has_lm
       FROM offres o
       WHERE o.id IN (${placeholders})
       ORDER BY o.scraped_at DESC, o.id DESC
       LIMIT ?`
    )
    .all(...ids, bounded) as {
      id: number;
      source: string;
      url: string;
      title: string;
      company: string;
      country: string | null;
      location: string | null;
      posted_at: string | null;
      score: number;
      is_vie: number;
      description_status: "ok" | "failed" | "partial";
      score_breakdown: string | null;
      description_text: string;
      contract_type: string | null;
      has_cv: number;
      has_lm: number;
    }[];
  return rows.map((row) => {
    const geo = resolveOfferLocation({ source: row.source, location: row.location, country: row.country });
    return {
      id: row.id,
      source: row.source,
      url: row.url,
      title: row.title,
      company: row.company,
      country: row.country,
      location: row.location,
      posted_at: row.posted_at,
      score: row.score,
      is_vie: row.is_vie,
      description_status: row.description_status,
      description_text: row.description_text.slice(0, 1000),
      score_reason: parseJson<{ reason?: string } | null>(row.score_breakdown, null)?.reason ?? null,
      contract_category: classifyContract({ contract_type: row.contract_type, title: row.title, description_text: row.description_text }),
      has_cv: Boolean(row.has_cv),
      has_lm: Boolean(row.has_lm),
      distance_km: null,
      same_city: false,
      same_dept: false,
      geo_label: geo.label,
      geo_precision: geo.precision,
    };
  });
}

export function newOffersFromLastScanCount(): number {
  return parseJson<unknown[]>(getSetting("last_scan_new_offer_ids"), [])
    .filter((id): id is number => typeof id === "number" && Number.isSafeInteger(id) && id > 0).length;
}

export function listOffres(opts?: {
  country?: string;
  source?: string;
  vieOnly?: boolean;
  minScore?: number;
}): OffreFiltered[] {
  ensureOffresRepaired();
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
  ensureOffresRepaired();
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
  // Colonne is_vie figée au scan : pour un chiffre qui corresponde à /offres?vie=1,
  // lire searchOffres().facets.contractCounts.vie (page /offres) ou vieFigure() (accueil).
  const vie = (db.prepare("SELECT COUNT(*) as c FROM offres WHERE is_vie = 1").get() as { c: number }).c;
  return { total, today, vie };
}
