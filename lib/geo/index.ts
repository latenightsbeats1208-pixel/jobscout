import "server-only";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { normalize, NORM_VERSION } from "./normalize.mjs";
import { ADMIN_AREAS, CITY_STATES, DEP_ALIASES, FR_ALIASES, FR_REGIONS, OVERSEAS_ISO } from "./tables";

// Moteur géographique HORS LIGNE : communes françaises (geo.api.gouv.fr) et
// villes du monde (GeoNames, CC BY 4.0), embarquées dans lib/geo/data (construites par
// scripts/build-geo.mjs ; sources et licences : THIRD_PARTY_NOTICES.txt).
// Aucun appel réseau :
// ni la ville de l'utilisateur ni les lieux des offres ne quittent le poste.
//
// Communes NON géolocalisées (Saint-Pierre-et-Miquelon, Saint-Barthélemy,
// Saint-Martin, Terres australes et antarctiques françaises, Wallis-et-Futuna,
// Clipperton : voir scripts/build-geo.mjs) : présentes dans la base avec leur
// nom, leurs codes et leur population, mais sans centre (lat et lng nulles),
// comme le point de leur collectivité. Elles se reconnaissent comme les autres
// (homonymes, codes postaux, code de collectivité), mais le résultat n'est pas
// placé (voir unplaced) : on ne les confond pas avec un homonyme placé ailleurs,
// et on ne peut pas les choisir comme ville de référence.

export type GeoPrecision = "commune" | "arrondissement" | "homonyme" | "ville" | "departement" | "region" | "pays" | "inconnu";
/** Lieu placé sur la carte. precision « departement » = point approximatif (barycentre). */
export type GeoPoint = { lat: number; lng: number; precision: GeoPrecision; label: string; code?: string };
/** Lieu non placé : seulement le pays ou la région, ou rien. */
export type GeoNone = { lat: null; lng: null; precision: "region" | "pays" | "inconnu"; label: string | null; /** Pays connu (ISO2), même sans ville. */ country?: string };
export type GeoResult = GeoPoint | GeoNone;
export type CommuneSuggestion = { code: string; label: string; cps: string[]; lat: number; lng: number };

// `code` d'un GeoPoint : code INSEE (commune, arrondissement, homonyme),
// code du département (departement), code pays ISO 3166-1 alpha-2 (ville).
// « homonyme » : commune française choisie parmi plusieurs du même nom sans
// département connu (métropole d'abord, puis la plus peuplée) — à afficher
// comme une hypothèse.

// ------------------------------------------------------------------ données

type Commune = {
  code: string;
  nom: string;
  dep: string;
  cps: string[];
  /** null : commune non géolocalisée. */
  lat: number | null;
  lng: number | null;
  pop: number;
  key: string;
  /** Numéro d'arrondissement municipal (Paris, Lyon, Marseille), 0 sinon. */
  arr: number;
  label: string;
  metro: boolean;
};
/** lat et lng null : collectivité non géolocalisée. */
type Dep = { code: string; nom: string; lat: number | null; lng: number | null; key: string; label: string };
type Region = { nom: string; deps: Set<string> };
type City = { name: string; cc: string; lat: number; lng: number; pop: number; admin1: string };
type Alias = { commune: Commune; label: string; lat: number | null; lng: number | null };
type Admin = { cc: string; code: string };
type IdList = number | number[];

type GeoDb = {
  communes: Commune[];
  communeByCode: Map<string, Commune>;
  communeByKey: Map<string, Commune[]>;
  /** Clés normalisées triées (recherche de préfixe par dichotomie) et index associés. */
  sortedKeys: string[];
  sortedIdx: Int32Array;
  communesByCp: Map<string, Commune[]>;
  sortedCps: string[];
  sortedCpIdx: Int32Array;
  deps: Map<string, Dep>;
  depByKey: Map<string, Dep>;
  regionByKey: Map<string, Region>;
  aliases: Map<string, Alias>;
  cities: City[];
  cityPrimary: Map<string, IdList>;
  cityAlt: Map<string, IdList>;
  countryName: Map<string, string>;
  countryByKey: Map<string, string>;
  cityState: Map<string, City>;
  adminByKey: Map<string, Admin[]>;
  adminAbbr: Map<string, string>;
  adminCodes: Map<string, Set<string>>;
  loadMs: number;
  loadError?: string;
};

type FrFile = {
  normVersion: number;
  communes: [string, string, string, string[], number | null, number | null, number, string][];
  deps: [string, string, number | null, number | null, string, string][];
};
type WorldFile = {
  normVersion: number;
  cities: [string, string, number, number, number, string, string, string][];
  countries: [string, string, string][];
};

const G = globalThis as typeof globalThis & {
  __jobscoutGeoDb?: GeoDb;
  __jobscoutGeoDbAt?: number;
  __jobscoutGeoMemo?: Map<string, GeoResult>;
  /** Chargements réussis de la base : change quand un nouvel essai réussit après un échec. */
  __jobscoutGeoGen?: number;
};

const DATA_DIR = path.join(process.cwd(), "lib/geo/data");
const ARR_CITY: Record<string, { name: string; prefix: string; max: number }> = {
  "75056": { name: "Paris", prefix: "751", max: 20 },
  "69123": { name: "Lyon", prefix: "6938", max: 9 },
  "13055": { name: "Marseille", prefix: "132", max: 16 },
};

const ARR_LIST = Object.entries(ARR_CITY);

function readGz<T>(name: string): T {
  const buf = fs.readFileSync(path.join(DATA_DIR, name));
  return JSON.parse(zlib.gunzipSync(buf).toString("utf8")) as T;
}

function ordinal(n: number): string {
  return n === 1 ? "1er" : `${n}e`;
}

function pushId(map: Map<string, IdList>, key: string, id: number) {
  const cur = map.get(key);
  if (cur === undefined) map.set(key, id);
  else if (typeof cur === "number") {
    if (cur !== id) map.set(key, [cur, id]);
  } else if (!cur.includes(id)) cur.push(id);
}
function ids(v: IdList | undefined): number[] {
  return v === undefined ? [] : typeof v === "number" ? [v] : v;
}

function loadDb(): GeoDb {
  const t0 = performance.now();
  const fr = readGz<FrFile>("geo-fr.json.gz");
  const world = readGz<WorldFile>("geo-world.json.gz");
  if (fr.normVersion !== NORM_VERSION || world.normVersion !== NORM_VERSION) {
    console.warn(
      `[geo] données construites avec la normalisation v${fr.normVersion}/${world.normVersion}, moteur en v${NORM_VERSION} : relancer node scripts/build-geo.mjs`,
    );
  }

  const communes: Commune[] = [];
  const communeByCode = new Map<string, Commune>();
  const communeByKey = new Map<string, Commune[]>();
  const communesByCp = new Map<string, Commune[]>();
  for (const [code, nom, dep, cps, lat, lng, pop, key] of fr.communes) {
    let arr = 0;
    let label = `${nom} (${dep})`;
    for (const [whole, a] of ARR_LIST) {
      if (code !== whole && code.startsWith(a.prefix) && code.length === 5) {
        const n = Number(code.slice(a.prefix.length));
        if (n >= 1 && n <= a.max) {
          arr = n;
          label = `${a.name} ${ordinal(n)}`;
        }
      }
    }
    const c: Commune = { code, nom, dep, cps, lat, lng, pop, key, arr, label, metro: dep.length === 2 };
    communes.push(c);
    communeByCode.set(code, c);
    const list = communeByKey.get(key);
    if (list) list.push(c);
    else communeByKey.set(key, [c]);
    for (const cp of cps) {
      const l = communesByCp.get(cp);
      if (l) l.push(c);
      else communesByCp.set(cp, [c]);
    }
  }
  const order = communes.map((_, i) => i).sort((a, b) => (communes[a].key < communes[b].key ? -1 : communes[a].key > communes[b].key ? 1 : 0));
  const sortedKeys = order.map((i) => communes[i].key);
  const sortedIdx = Int32Array.from(order);
  const cpPairs: [string, number][] = [];
  for (let i = 0; i < communes.length; i++) for (const cp of communes[i].cps) cpPairs.push([cp, i]);
  cpPairs.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const sortedCps = cpPairs.map((p) => p[0]);
  const sortedCpIdx = Int32Array.from(cpPairs.map((p) => p[1]));

  const deps = new Map<string, Dep>();
  const depByKey = new Map<string, Dep>();
  const regionDeps = new Map<string, Set<string>>();
  for (const [code, nom, lat, lng, region, key] of fr.deps) {
    const d: Dep = { code, nom, lat, lng, key, label: `${nom} (${code})` };
    deps.set(code, d);
    depByKey.set(key, d);
    if (region) {
      const s = regionDeps.get(region) ?? new Set<string>();
      s.add(code);
      regionDeps.set(region, s);
    }
  }
  for (const [name, code] of Object.entries(DEP_ALIASES)) {
    const d = deps.get(code);
    if (d) depByKey.set(normalize(name), d);
  }
  const regionByKey = new Map<string, Region>();
  for (const r of FR_REGIONS) {
    const set = r.code ? regionDeps.get(r.code) : new Set(r.deps ?? []);
    if (!set || set.size === 0) continue;
    const region: Region = { nom: r.nom, deps: set };
    for (const n of [r.nom, ...r.aliases]) regionByKey.set(normalize(n), region);
  }

  const aliases = new Map<string, Alias>();
  for (const [name, a] of Object.entries(FR_ALIASES)) {
    const c = communeByCode.get(a.code);
    if (!c) continue;
    aliases.set(normalize(name), { commune: c, label: a.label ?? c.label, lat: a.lat ?? c.lat, lng: a.lng ?? c.lng });
  }

  const cities: City[] = [];
  const cityPrimary = new Map<string, IdList>();
  const cityAlt = new Map<string, IdList>();
  const adminCodes = new Map<string, Set<string>>();
  for (let i = 0; i < world.cities.length; i++) {
    const [name, cc, lat, lng, pop, admin1, prim, alt] = world.cities[i];
    cities.push({ name, cc, lat, lng, pop, admin1 });
    for (const k of prim.split("|")) if (k) pushId(cityPrimary, k, i);
    if (alt) for (const k of alt.split("|")) if (k) pushId(cityAlt, k, i);
    let s = adminCodes.get(cc);
    if (!s) adminCodes.set(cc, (s = new Set()));
    s.add(admin1);
  }
  const countryName = new Map<string, string>();
  const countryByKey = new Map<string, string>();
  for (const [iso, nom, keys] of world.countries) {
    countryName.set(iso, nom);
    for (const k of keys.split("|")) if (k && !countryByKey.has(k)) countryByKey.set(k, iso);
  }
  // Villes classées par population décroissante dans le fichier : la première
  // ville d'un micro-État est sa ville principale.
  const cityState = new Map<string, City>();
  for (const c of cities) if (CITY_STATES.has(c.cc) && !cityState.has(c.cc)) cityState.set(c.cc, c);

  const adminByKey = new Map<string, Admin[]>();
  const adminAbbr = new Map<string, string>();
  for (const a of ADMIN_AREAS) {
    for (const n of a.names) {
      const k = normalize(n);
      const l = adminByKey.get(k) ?? [];
      l.push({ cc: a.cc, code: a.code });
      adminByKey.set(k, l);
    }
    if (a.abbr) adminAbbr.set(`${a.cc}|${a.abbr}`, a.code);
  }

  return {
    communes,
    communeByCode,
    communeByKey,
    sortedKeys,
    sortedIdx,
    communesByCp,
    sortedCps,
    sortedCpIdx,
    deps,
    depByKey,
    regionByKey,
    aliases,
    cities,
    cityPrimary,
    cityAlt,
    countryName,
    countryByKey,
    cityState,
    adminByKey,
    adminAbbr,
    adminCodes,
    loadMs: performance.now() - t0,
  };
}

/** Base vide : sans fichiers de données, tout lieu revient « inconnu » au lieu de faire tomber la page. */
function emptyDb(error: string): GeoDb {
  return {
    communes: [],
    communeByCode: new Map(),
    communeByKey: new Map(),
    sortedKeys: [],
    sortedIdx: new Int32Array(0),
    communesByCp: new Map(),
    sortedCps: [],
    sortedCpIdx: new Int32Array(0),
    deps: new Map(),
    depByKey: new Map(),
    regionByKey: new Map(),
    aliases: new Map(),
    cities: [],
    cityPrimary: new Map(),
    cityAlt: new Map(),
    countryName: new Map(),
    countryByKey: new Map(),
    cityState: new Map(),
    adminByKey: new Map(),
    adminAbbr: new Map(),
    adminCodes: new Map(),
    loadMs: 0,
    loadError: error,
  };
}

function db(): GeoDb {
  const failed = G.__jobscoutGeoDb?.loadError && Date.now() - (G.__jobscoutGeoDbAt ?? 0) > 60_000;
  if (!G.__jobscoutGeoDb || failed) {
    G.__jobscoutGeoDbAt = Date.now();
    try {
      G.__jobscoutGeoDb = loadDb();
      // Base (re)chargée : les lieux placés pendant une panne (base vide) sont
      // oubliés, et le cache des offres (lib/db/offres.ts, via geoGeneration)
      // est reconstruit, sans attendre une écriture en base ni un redémarrage.
      G.__jobscoutGeoGen = (G.__jobscoutGeoGen ?? 0) + 1;
      G.__jobscoutGeoMemo?.clear();
    } catch (e) {
      // Erreur visible dans le journal du serveur, une seule fois ; le filtre
      // distance est alors inopérant mais la liste des offres reste servie.
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[geo] base géographique illisible (${DATA_DIR}) : ${msg}`);
      G.__jobscoutGeoDb = emptyDb(msg);
    }
  }
  return G.__jobscoutGeoDb;
}

// ------------------------------------------------------------------ outils

/** La base géographique est-elle chargée ? (sinon : message de l'erreur, pour l'interface). */
export function geoStatus(): { ok: boolean; error: string | null } {
  const error = db().loadError ?? null;
  return { ok: !error, error };
}

/**
 * Numéro du chargement réussi en cours (0 tant qu'aucun n'a réussi). Entre dans
 * l'empreinte du cache des offres : un nouvel essai réussi après une panne le
 * fait reconstruire avec les vraies positions.
 */
export function geoGeneration(): number {
  db();
  return G.__jobscoutGeoGen ?? 0;
}

export function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371.0088;
  const toRad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * toRad;
  const dLng = (b.lng - a.lng) * toRad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * toRad) * Math.cos(b.lat * toRad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

function lowerBound(arr: string[], x: string): number {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (arr[mid] < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Communes (hors arrondissements) dont la clé commence par `n` + espace. */
function prefixCommunes(n: string): Commune[] {
  const d = db();
  const p = `${n} `;
  const out: Commune[] = [];
  for (let i = lowerBound(d.sortedKeys, p); i < d.sortedKeys.length && d.sortedKeys[i].startsWith(p); i++) {
    const c = d.communes[d.sortedIdx[i]];
    if (!c.arr) out.push(c);
  }
  return out;
}

/**
 * Métropole avant outre-mer, puis la plus peuplée — sauf si la commune de
 * métropole est un hameau face à une ville d'outre-mer 20 fois plus grande
 * (ex. « Le Port » : la ville de La Réunion plutôt que le village de l'Ariège).
 */
function best(list: Commune[]): Commune {
  let m: Commune | null = null;
  let o: Commune | null = null;
  for (const c of list) {
    if (c.metro) {
      if (!m || c.pop > m.pop) m = c;
    } else if (!o || c.pop > o.pop) o = c;
  }
  if (m && o && m.pop < 2000 && o.pop >= 10000 && o.pop >= 20 * m.pop) return o;
  return (m ?? o) as Commune;
}

const DEP_CODE_RE = /^(0[1-9]|[1-8]\d|9[0-5]|2a|2b|97[1-8]|98[4-9])$/;
function depCodeOf(tok: string): string | null {
  if (!DEP_CODE_RE.test(tok)) return null;
  const code = tok.toUpperCase();
  return db().deps.has(code) ? code : null;
}

/** Préfixes et suffixes de zone retirés en second essai (« X et périphérie »…). */
const ZONE_PREFIX =
  /^(?:region metropolitaine d(?:e|u|es)?|agglomeration d(?:e|u|es)?|agglomeration|metropole d(?:e|u|es)?|grand|greater|ville d(?:e|u)?|commune d(?:e|u)?|centre ville d(?:e|u)?|departement d(?:e la|e l|e|u|es)?|gouvernorat d(?:e|u)?|gouvernorat|prefecture d(?:e|u)?|district d(?:e|u)?|province d(?:e|u)?|wilaya d(?:e)?|city of|canton d(?:e|u)?|bassin d(?:e|u)?|secteur d(?:e|u)?|region d(?:e|u)?|zone d(?:e|u)?) /;
const ZONE_SUFFIX =
  / (?:et peripherie|et sa peripherie|et environs|et alentours|metropolitan area|metropolitan region|metro area|metropolitan|centre ville|centre|cedex(?: \d+)?|city|ville|metropole|agglomeration|region|area metropolitana|commune|mairie|nord|sud|est|ouest)$/;
const ZONE_MARK = /^(?:region metropolitaine|agglomeration|greater|grand|region d(?:e|u|es)?)\b| (?:et peripherie|et sa peripherie|et environs|metropolitan area|metropolitan region|metro area)$/;

function variants(n: string): string[] {
  const out = [n];
  let t = n.replace(/\bcedex\b(?: \d+)?/g, " ").replace(/\s+/g, " ").trim();
  if (t && t !== n) out.push(t);
  let prev = "";
  while (t && t !== prev) {
    prev = t;
    t = t.replace(ZONE_PREFIX, "").replace(ZONE_SUFFIX, "").trim();
    if (t && !out.includes(t)) out.push(t);
  }
  return out;
}

// ------------------------------------------------------------------ France

type FrHit = { commune: Commune; precision: GeoPrecision; label?: string; lat?: number | null; lng?: number | null };

const PREFIX_STOP = new Set(["saint", "sainte", "saints", "le", "la", "les", "val", "mont", "port", "pont", "bourg", "ville", "grand", "petit", "bois", "font"]);

/**
 * Nom d'un seul mot qui désigne en pratique une commune plus longue (« EVRY »
 * → Évry-Courcouronnes plutôt qu'Évry (89), 402 habitants). Réservé aux noms
 * d'un mot : « Saint-Pierre » n'est pas un « Saint-Pierre-des-Corps » tronqué.
 */
function bigPrefix(n: string, pop: number): Commune | null {
  if (n.length < 4 || n.includes(" ") || PREFIX_STOP.has(n)) return null;
  const p = prefixCommunes(n);
  if (!p.length) return null;
  const b = best(p);
  return b.pop >= Math.max(10000, 20 * pop) ? b : null;
}

function findCommune(n: string, deps: Set<string> | null, rdeps: Set<string> | null, cps: string[]): FrHit | null {
  if (!n || n.length < 2) return null;
  const d = db();
  const alias = d.aliases.get(n);
  const exact = d.communeByKey.get(n) ?? [];
  const inDeps = (c: Commune) => (!deps || deps.has(c.dep)) && (!rdeps || rdeps.has(c.dep));
  const prefixOk = n.length >= 4 && !PREFIX_STOP.has(n);

  if (deps || rdeps || cps.length) {
    // Paliers : code postal exact, puis département du code postal ; à chaque
    // palier, nom exact, puis alias, puis nom tronqué (« Saint-Ouen - 93 » → Saint-Ouen-sur-Seine).
    const cpDeps = new Set<string>();
    for (const cp of cps) for (const c of d.communesByCp.get(cp) ?? []) cpDeps.add(c.dep);
    const tiers: ((c: Commune) => boolean)[] = cps.length
      ? [(c) => inDeps(c) && c.cps.some((cp) => cps.includes(cp)), (c) => inDeps(c) && cpDeps.has(c.dep)]
      : [inDeps];
    const strong = !!deps || cps.length > 0;
    const prefix = prefixOk ? prefixCommunes(n) : [];
    for (const ok of tiers) {
      const cand = exact.filter(ok);
      if (cand.length) return { commune: best(cand), precision: strong || cand.length === 1 ? "commune" : "homonyme" };
      if (alias && ok(alias.commune)) return { commune: alias.commune, precision: "commune", label: alias.label, lat: alias.lat, lng: alias.lng };
      const p = prefix.filter(ok);
      if (p.length) return { commune: best(p), precision: strong || p.length === 1 ? "commune" : "homonyme" };
    }
    return null;
  }

  if (alias) return { commune: alias.commune, precision: "commune", label: alias.label, lat: alias.lat, lng: alias.lng };
  if (exact.length) {
    const b = best(exact);
    if (b.pop < (exact.length === 1 ? 2000 : 5000)) {
      const big = bigPrefix(n, b.pop);
      if (big) return { commune: big, precision: "homonyme" };
    }
    return { commune: b, precision: exact.length === 1 ? "commune" : "homonyme" };
  }
  if (prefixOk) {
    const p = prefixCommunes(n);
    if (p.length) return { commune: best(p), precision: p.length === 1 ? "commune" : "homonyme" };
  }
  return null;
}

const ARR_RE =
  /^(paris|lyon|marseille) (\d{1,2})(?: ?(?:er|re|e|eme|ieme|em))?(?: arr(?:ondissement)?)?$|^(\d{1,2})(?:er|re|e|eme|ieme) arr(?:ondissement)?(?: de)? (paris|lyon|marseille)$/;
const ARR_WHOLE: Record<string, string> = { paris: "75056", lyon: "69123", marseille: "13055" };

/** « Paris 01 », « Paris 11e Arrondissement », « Lyon 3e »… → arrondissement. */
function parseArrondissement(n: string, apec: boolean): FrHit | null {
  const m = ARR_RE.exec(n);
  if (!m) return null;
  const city = (m[1] ?? m[4]) as string;
  const num = Number(m[2] ?? m[3]);
  const whole = db().communeByCode.get(ARR_WHOLE[city]);
  const a = ARR_CITY[ARR_WHOLE[city]];
  if (!whole || !a || num < 1 || num > a.max) return null;
  // APEC met « 01 » par défaut quand l'annonce ne précise pas l'arrondissement :
  // on reste au niveau de la ville.
  if (apec && num === 1) return { commune: whole, precision: "commune" };
  const code = `${a.prefix}${String(num).padStart(5 - a.prefix.length, "0")}`;
  const c = db().communeByCode.get(code);
  return c ? { commune: c, precision: "arrondissement" } : null;
}

/** Paris, Lyon, Marseille entières + code postal d'arrondissement → l'arrondissement. */
function refineWithCp(hit: FrHit, cps: string[]): FrHit {
  const a = ARR_CITY[hit.commune.code];
  if (!cps.length || !a) return hit;
  for (const cp of cps) {
    const arr = (db().communesByCp.get(cp) ?? []).find((c) => c.arr && c.code.startsWith(a.prefix));
    if (arr) return { commune: arr, precision: "arrondissement" };
  }
  return hit;
}

/**
 * Lieux reconnus mais non géolocalisés → ce qu'aurait été leur point (précision,
 * code). resolveUncached décide sur cette base exactement comme pour un lieu placé
 * (pas d'autre texte essayé, même repli sans indice), puis rend le GeoNone.
 */
const UNPLACED = new WeakMap<GeoNone, { precision: GeoPrecision; code: string }>();
const ISO_OF_DEP: Record<string, string> = Object.fromEntries(Object.entries(OVERSEAS_ISO).map(([iso, dep]) => [dep, iso]));

/**
 * Commune ou collectivité sans centre : non placée, avec le libellé reconnu et le
 * code du territoire (« BL », « PM »…) comme pays. Ce n'est donc pas une offre « en
 * France sans ville précise » (lib/db/offres.ts), qu'« Les inclure » ajouterait à
 * tout rayon : son lieu est connu, à plus de 200 km (le plus grand rayon) de toute
 * commune placée (au plus près, 212 km de Saint-Barthélemy à Deshaies, d'après les
 * centres retirés).
 */
function unplaced(label: string, precision: GeoPrecision, code: string, dep: string): GeoNone {
  const iso = ISO_OF_DEP[dep];
  const r: GeoNone = iso
    ? { lat: null, lng: null, precision: "inconnu", label, country: iso }
    : { lat: null, lng: null, precision: "inconnu", label };
  UNPLACED.set(r, { precision, code });
  return r;
}

/** Précision et code du lieu reconnu, placé ou non (null : rien de reconnu en deçà du pays ou de la région). */
function placedAs(r: GeoResult): { precision: GeoPrecision; code: string | undefined } | null {
  if (r.lat !== null) return { precision: r.precision, code: r.code };
  return UNPLACED.get(r) ?? null;
}

function frPoint(hit: FrHit): GeoResult {
  const c = hit.commune;
  const lat = hit.lat ?? c.lat;
  const lng = hit.lng ?? c.lng;
  const precision: GeoPrecision = c.arr ? "arrondissement" : hit.precision;
  const label = hit.label ?? c.label;
  if (lat === null || lng === null) return unplaced(label, precision, c.code, c.dep);
  return { lat, lng, precision, label, code: c.code };
}

function depPoint(d: Dep): GeoResult {
  if (d.lat === null || d.lng === null) return unplaced(d.label, "departement", d.code, d.code);
  return { lat: d.lat, lng: d.lng, precision: "departement", label: d.label, code: d.code };
}

function findFrenchPlace(n: string, deps: Set<string> | null, rdeps: Set<string> | null, cps: string[], apec: boolean): FrHit | null {
  for (const v of variants(n)) {
    const arr = parseArrondissement(v, apec);
    if (arr && (!deps || deps.has(arr.commune.dep))) return arr;
    const hit = findCommune(v, deps, rdeps, cps);
    if (hit) return refineWithCp(hit, cps);
    // « Montreuil 93 », « Saint-Denis 974 » (département collé au nom).
    const m = /^(.*\S) (\S+)$/.exec(v);
    const dep = m ? depCodeOf(m[2]) : null;
    if (m && dep && (!deps || deps.has(dep))) {
      const h = findCommune(m[1], new Set([dep]), null, cps);
      if (h) return h;
    }
  }
  // Article omis (« Kremlin-Bicêtre »).
  if (!/^(le|la|les|l) /.test(n)) {
    for (const art of ["le", "la", "les", "l"]) {
      const exact = db().communeByKey.get(`${art} ${n}`);
      if (exact) {
        const cand = exact.filter((c) => (!deps || deps.has(c.dep)) && (!rdeps || rdeps.has(c.dep)));
        if (cand.length) return { commune: best(cand), precision: deps || cand.length === 1 ? "commune" : "homonyme" };
      }
    }
  }
  return null;
}

/** Code(s) postal(aux) sans nom reconnu : commune du code, ou celle dont le nom figure dans le texte. */
function communeFromCps(cps: string[], textKey: string): FrHit | null {
  for (const cp of cps) {
    const list = (db().communesByCp.get(cp) ?? []).filter((c) => !ARR_CITY[c.code]);
    if (!list.length) continue;
    const named = list.filter((c) => ` ${textKey} `.includes(` ${c.key} `));
    return { commune: best(named.length ? named : list), precision: "commune" };
  }
  return null;
}

// ------------------------------------------------------------------ monde

/**
 * Ville la plus peuplée du pays parmi les candidats. Si une subdivision connue
 * du pays est donnée (« Maine », « VD », « QC »), elle est obligatoire : on ne
 * place pas « Falmouth, Maine » à Falmouth (Massachusetts).
 */
function pickCity(list: number[], iso: string | null, admin: Set<string>): City | null {
  const d = db();
  let b: City | null = null;
  let bAdmin = false;
  let required = false;
  for (const i of list) {
    const c = d.cities[i];
    if (iso && c.cc !== iso) continue;
    const valid = admin.size > 0 && [...admin].some((a) => d.adminCodes.get(c.cc)?.has(a));
    if (valid) required = true;
    const a = admin.has(c.admin1);
    if (!b || (a && !bAdmin) || (a === bAdmin && c.pop > b.pop)) {
      b = c;
      bAdmin = a;
    }
  }
  if (b && required && !bAdmin) return null;
  return b;
}

function lookupCity(n: string, iso: string | null, admin: Set<string>, altOk: boolean): City | null {
  const d = db();
  const p = pickCity(ids(d.cityPrimary.get(n)), iso, admin);
  if (p) return p;
  if (!altOk) return null;
  const a = pickCity(ids(d.cityAlt.get(n)), iso, admin);
  // Sans pays connu, un nom alternatif seul ne suffit que pour une grande ville.
  if (a && (iso || a.pop >= 100000)) return a;
  return null;
}

function cityPoint(c: City): GeoPoint {
  const country = db().countryName.get(c.cc) ?? c.cc;
  const label = normalize(c.name) === normalize(country) ? c.name : `${c.name}, ${country}`;
  return { lat: c.lat, lng: c.lng, precision: "ville", label, code: c.cc };
}

function findWorldPlace(seg: Seg, iso: string | null, admin: Set<string>, altOk: boolean): GeoPoint | null {
  const vs = variants(seg.n);
  for (const v of vs) {
    const c = lookupCity(v, iso, admin, altOk);
    if (c) return cityPoint(c);
  }
  // Agglomération à plusieurs noms : « Miami-Fort Lauderdale et périphérie » → Miami.
  if (ZONE_MARK.test(seg.n) && seg.raw.includes("-")) {
    for (const v of variants(normalize(seg.raw.split("-")[0]))) {
      const c = lookupCity(v, iso, admin, false);
      if (c) return cityPoint(c);
    }
  }
  if (iso) {
    // « Leuze-en-Hainaut » (GeoNames : Leuze), « Mc Lean » (McLean).
    const v = vs[vs.length - 1];
    const short = v.replace(/ (?:en|sur|sous|les|lez|am|an der|bei|im|upon|on) .+$/, "");
    const mc = v.replace(/\bmc /g, "mc");
    for (const x of [short, mc]) {
      if (x !== v && x.length >= 4) {
        const c = lookupCity(x, iso, admin, false);
        if (c) return cityPoint(c);
      }
    }
    // « Méchouar de Casablanca », « Préfecture de X » : la ville citée après « de ».
    const m = /^.+ (?:de|du|des|d) (.{4,})$/.exec(vs[vs.length - 1]);
    if (m) {
      const c = lookupCity(m[1], iso, admin, false);
      if (c) return cityPoint(c);
    }
  }
  return null;
}

// ------------------------------------------------------------------ résolution

type Seg = { raw: string; n: string; paren: boolean };

function splitSegments(text: string): Seg[] {
  const parens: string[] = [];
  const t = text
    .replace(/[   ]/g, " ")
    .replace(/\(([^()]*)\)/g, (_m, inner: string) => {
      parens.push(inner);
      return " , ";
    })
    .replace(/[()]/g, " ");
  const segs: Seg[] = [];
  const push = (raw: string, paren: boolean) => {
    const r = raw.trim();
    const n = normalize(r);
    if (n) segs.push({ raw: r, n, paren });
  };
  for (const part of t.split(/\s*[,;|•\n]\s*|\s+[-–—]\s+|\s*\/\s*/)) push(part, false);
  for (const p of parens) for (const part of p.split(/\s*[,;/]\s*/)) push(part, true);
  return segs;
}

const NONE_UNKNOWN: GeoNone = { lat: null, lng: null, precision: "inconnu", label: null };

function nonePays(iso: string): GeoNone {
  return { lat: null, lng: null, precision: "pays", label: db().countryName.get(iso) ?? iso, country: iso };
}

/** Un nom de pays, de département ou de région qui est aussi une vraie ville (Paris, Mayenne, Vienne). */
function isBigCommune(n: string): boolean {
  return (db().communeByKey.get(n) ?? []).some((c) => c.pop >= 5000);
}

function resolveText(text: string, fieldIso: string | null, apec: boolean, hintDeps: string[] = []): GeoResult {
  const d = db();
  const segs = splitSegments(text);
  if (!segs.length) return NONE_UNKNOWN;
  const lastMain = segs.reduce((acc, s, i) => (s.paren ? acc : i), -1);

  // Passe 1 : codes postaux, codes de département, pays.
  type Item = Seg & { kind: "place" | "done" | "code2"; i: number };
  const items: Item[] = [];
  const cps: string[] = [];
  const strongDeps = new Set<string>(hintDeps);
  let depHit: Dep | null = null;
  let textIso: string | null = null;
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    let n = s.n;
    for (const m of s.raw.matchAll(/(?<!\d)(\d{5})(?!\d)/g)) {
      if (d.communesByCp.has(m[1])) {
        cps.push(m[1]);
        n = n.replace(m[1], " ").replace(/\s+/g, " ").trim();
      }
    }
    if (!n) continue;
    const code = depCodeOf(n);
    if (code) {
      strongDeps.add(code);
      depHit ??= d.deps.get(code) ?? null;
      continue;
    }
    // Code à deux lettres : pays s'il confirme le champ pays, sinon État ou canton (« San Mateo, CA »).
    if (/^[A-Za-z]{2}$/.test(s.raw)) {
      if (fieldIso && s.raw.toUpperCase() === fieldIso) textIso = fieldIso;
      else items.push({ ...s, n, kind: "code2", i });
      continue;
    }
    const iso = d.countryByKey.get(n);
    if (iso && (i === lastMain || s.paren || segs.length === 1) && !isBigCommune(n)) {
      textIso = iso;
      continue;
    }
    items.push({ ...s, n, kind: "place", i });
  }

  let iso: string | null = textIso ?? fieldIso;
  if (iso && OVERSEAS_ISO[iso]) {
    strongDeps.add(OVERSEAS_ISO[iso]);
    depHit ??= d.deps.get(OVERSEAS_ISO[iso]) ?? null;
    iso = "FR";
  }

  // Passe 2 : départements et régions françaises, subdivisions étrangères.
  let region: Region | null = null;
  const admin = new Set<string>();
  let adminIso: string | null = null;
  let firstAdminIso: string | null = null;
  const firstPlace = items.find((it) => it.kind === "place");
  for (const it of items) {
    if (it.kind === "code2") {
      const up = it.raw.toUpperCase();
      admin.add(iso ? (d.adminAbbr.get(`${iso}|${up}`) ?? up) : up);
      it.kind = "done";
      continue;
    }
    const big = isBigCommune(it.n);
    if (iso === "FR" || iso === null) {
      const dep = d.depByKey.get(it.n);
      if (dep && !big) {
        strongDeps.add(dep.code);
        depHit ??= dep;
        it.kind = "done";
        continue;
      }
      const reg = d.regionByKey.get(it.n);
      if (reg && !big) {
        region ??= reg;
        it.kind = "done";
        continue;
      }
    }
    if (iso !== "FR") {
      const areas = (d.adminByKey.get(it.n) ?? []).filter((a) => !iso || a.cc === iso);
      if (areas.length) {
        const sameCc = areas.every((a) => a.cc === areas[0].cc);
        // Premier segment : d'abord une ville (« New York », « Québec »), la
        // subdivision ne sert qu'à deviner le pays si aucune ville ne répond.
        if (it === firstPlace) {
          if (!iso && sameCc) firstAdminIso = areas[0].cc;
        } else {
          for (const a of areas) admin.add(a.code);
          if (!iso && sameCc) adminIso ??= areas[0].cc;
          it.kind = "done";
          continue;
        }
      }
    }
    if (it.paren && /^[a-z]{2,3}$/i.test(it.raw)) admin.add(it.raw.toUpperCase());
  }
  const places = items.filter((it) => it.kind === "place");
  if (!iso && !depHit && !region && !strongDeps.size && !cps.length && adminIso) iso = adminIso;
  if (!iso && (depHit || region || strongDeps.size || cps.length)) iso = "FR";

  if (iso === "FR" || iso === null) {
    const deps = strongDeps.size ? strongDeps : null;
    const rdeps = region?.deps ?? null;
    for (const s of places) {
      const hit = findFrenchPlace(s.n, deps, rdeps, cps, apec);
      if (hit) return frPoint(hit);
      if (iso === null && !s.paren) {
        const w = findWorldPlace(s, null, admin, s === firstPlace);
        if (w) return w;
      }
    }
    if (cps.length) {
      const hit = communeFromCps(cps, normalize(text));
      if (hit) return frPoint(hit);
    }
    if (strongDeps.size === 1) {
      const only = d.deps.get([...strongDeps][0]);
      if (only) return depPoint(only);
    }
    if (depHit) return depPoint(depHit);
    if (region) return { lat: null, lng: null, precision: "region", label: region.nom, country: "FR" };
    if (iso === "FR") return nonePays("FR");
    if (firstAdminIso) return nonePays(firstAdminIso);
    return NONE_UNKNOWN;
  }

  for (const s of places) {
    const w = findWorldPlace(s, iso, admin, s === firstPlace);
    if (w) return w;
  }
  // Pays seul d'un micro-État → sa ville. Pas au Luxembourg si une localité
  // inconnue est citée (une localité du nord peut être à 60 km de la capitale).
  const cs = d.cityState.get(iso);
  if (cs && !(iso === "LU" && places.length)) return cityPoint(cs);
  return nonePays(iso);
}

/** En-tête Talent : « Entreprise • Ville, Région, FR », « Renens (VD) », « Bern, Schweiz | 80-100% ». */
function headLocation(head: string): { text: string; strict: boolean } | null {
  const lines = head
    .slice(0, 600)
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 8);
  for (const l of lines) {
    const i = l.lastIndexOf("•");
    if (i >= 0) {
      const after = l.slice(i + 1).trim();
      if (after && after.length <= 120) return { text: after, strict: false };
    }
  }
  for (const l of lines) {
    if (/^\p{Lu}[\p{L}'’. -]{1,40} \((?:[A-Z]{2}|\d{2,3})\)$/u.test(l)) return { text: l, strict: true };
    const bar = l.split(" | ")[0];
    if (bar !== l && /^\p{Lu}[\p{L}'’. -]{1,40}(?:, \p{Lu}[\p{L}'’. -]{1,40})?$/u.test(bar)) return { text: bar, strict: true };
  }
  return null;
}

const REMOTE_VALUES = /^(fulltime|partial|punctual|no|unknown)$/i;
const RANK: Record<string, number> = { region: 3, pays: 2, inconnu: 1 };

function resolveUncached(input: { source: string; location: string | null; country: string | null; hint?: string | null; head?: string | null }): GeoResult {
  const d = db();
  const source = (input.source ?? "").toLowerCase();
  const apec = source === "apec";
  let remoteFull = false;
  let hintText: string | null = null;
  const hint = input.hint?.trim() || null;
  if (hint) {
    if (source === "wttj" || REMOTE_VALUES.test(hint)) remoteFull = hint.toLowerCase() === "fulltime";
    else hintText = hint;
  }
  // Indice réduit à un code de département (France Travail : le département
  // glisse parfois dans le champ entreprise, « 974 ») : contrainte, pas lieu.
  let hintDeps: string[] = [];
  if (hintText) {
    const code = depCodeOf(normalize(hintText));
    if (code) {
      hintDeps = [code];
      hintText = null;
    }
  }

  let fieldIso: string | null = null;
  let pollutedCountry: string | null = null;
  const countryRaw = input.country?.trim() || null;
  if (countryRaw) {
    const n = normalize(countryRaw);
    fieldIso = d.countryByKey.get(n) ?? (/^[a-z]{2}$/.test(n) && d.countryName.has(n.toUpperCase()) ? n.toUpperCase() : null);
    // Champ pays pollué (« Montpellier », « Saône-et-Loire ») : lu comme un lieu.
    if (!fieldIso) pollutedCountry = countryRaw;
  }

  const texts: { text: string; strict: boolean }[] = [];
  if (hintText) texts.push({ text: hintText, strict: false });
  const location = input.location?.trim() || null;
  if (location) texts.push({ text: location, strict: false });
  else if (input.head) {
    const h = headLocation(input.head);
    if (h) texts.push(h);
  }
  if (pollutedCountry) texts.push({ text: pollutedCountry, strict: false });

  const fieldPays = (): GeoResult | null => {
    if (!fieldIso) return null;
    const iso = OVERSEAS_ISO[fieldIso] ? "FR" : fieldIso;
    const cs = !texts.length ? db().cityState.get(iso) : undefined;
    return cs ? cityPoint(cs) : nonePays(iso);
  };
  let fallback: GeoResult | null = null;
  // Lieu reconnu mais non géolocalisé (placedAs) : mêmes décisions que s'il était placé.
  const precise = (r: GeoResult) => {
    const p = placedAs(r);
    return !!p && p.precision !== "departement";
  };
  for (const t of texts) {
    let r = resolveText(t.text, fieldIso, apec, hintDeps);
    if (hintDeps.length && !precise(r)) {
      const free = resolveText(t.text, fieldIso, apec);
      if (precise(free)) r = free;
    }
    const found = placedAs(r);
    if (found) {
      // En-tête lu sans marqueur fiable : on n'accepte qu'un lieu du pays de l'offre.
      if (t.strict && fieldIso && !(fieldIso === "FR" ? /^\d|^2[AB]/.test(found.code ?? "") : found.code === fieldIso)) continue;
      return r;
    }
    if (!t.strict && (!fallback || RANK[r.precision] > RANK[fallback.precision])) fallback = r;
  }
  if (!fallback || fallback.precision === "inconnu") fallback = fieldPays() ?? fallback ?? NONE_UNKNOWN;
  if (remoteFull && fallback.lat === null) return { lat: null, lng: null, precision: "inconnu", label: "Télétravail complet" };
  return fallback;
}

const MEMO_MAX = 50000;

/**
 * Place le lieu d'une offre. `hint` : indice propre à la source (APEC :
 * raw_payload.lieuTexte « Montreuil - 93 » ; WTTJ : raw_payload.remote, où
 * « fulltime » sans lieu placé donne GeoNone « Télétravail complet »).
 * `head` : début de description_text (600 premiers caractères lus), utilisé
 * seulement quand `location` est vide (Talent). Résultat gelé, mémoïsé
 * seulement quand la base géographique est chargée (pendant une panne, rien
 * n'est retenu : le nouvel essai replace les mêmes lieux).
 */
export function resolveOfferLocation(input: { source: string; location: string | null; country: string | null; hint?: string | null; head?: string | null }): GeoResult {
  const memo = (G.__jobscoutGeoMemo ??= new Map<string, GeoResult>());
  const headKey = input.location?.trim() ? "" : (input.head ?? "").slice(0, 600);
  const key = [input.source, input.location ?? "", input.country ?? "", input.hint ?? "", headKey].join("\u0001");
  const hit = memo.get(key);
  if (hit) return hit;
  const r = Object.freeze(resolveUncached(input)) as GeoResult;
  if (db().loadError) return r;
  if (memo.size >= MEMO_MAX) memo.clear();
  memo.set(key, r);
  return r;
}

// ------------------------------------------------------------------ ville de l'utilisateur

type LocatedCommune = Commune & { lat: number; lng: number };
/** Commune géolocalisée : seules celles-ci peuvent être ville de référence (une distance se calcule depuis leur centre). */
function located(c: Commune | undefined): c is LocatedCommune {
  return !!c && c.lat !== null && c.lng !== null;
}

function toSuggestion(c: LocatedCommune): CommuneSuggestion {
  return { code: c.code, label: c.label, cps: c.cps, lat: c.lat, lng: c.lng };
}

/** Commune géolocalisée de ce code INSEE (null : code inconnu, ou commune non géolocalisée). */
export function communeByCode(code: string): CommuneSuggestion | null {
  const c = db().communeByCode.get(String(code ?? "").trim());
  return located(c) ? toSuggestion(c) : null;
}

/**
 * Communes par début de nom normalisé (accents, tirets, apostrophes, « st »),
 * par code postal (exact ou préfixe d'au moins 2 chiffres) ou par « nom (dép) ».
 * Tri : nom exact, puis début du nom, puis mot intérieur ; à égalité, population.
 */
export function suggestCommunes(query: string, limit = 8): CommuneSuggestion[] {
  const d = db();
  const q = normalize(query ?? "");
  if (!q || limit <= 0) return [];

  if (/^\d{2,5}$/.test(q)) {
    const seen = new Set<Commune>();
    const scored: { c: Commune; s: number }[] = [];
    for (let i = lowerBound(d.sortedCps, q); i < d.sortedCps.length && d.sortedCps[i].startsWith(q); i++) {
      const c = d.communes[d.sortedCpIdx[i]];
      if (seen.has(c)) continue;
      seen.add(c);
      if (ARR_CITY[c.code] && q.length === 5) continue; // 75011 → Paris 11e plutôt que Paris entier
      scored.push({ c, s: (d.sortedCps[i] === q ? 10 : 0) + Math.log10(c.pop + 10) });
    }
    return pick(scored, limit);
  }

  let name = q;
  let dep: string | null = null;
  let cp: string | null = null;
  const mCp = /^(.*\S) (\d{5})$/.exec(q);
  const mDep = /^(.*\S) (\d{2,3}|2a|2b)$/.exec(q);
  if (mCp) {
    name = mCp[1];
    cp = mCp[2];
  } else if (mDep && depCodeOf(mDep[2]) && !/^(paris|lyon|marseille)$/.test(mDep[1])) {
    name = mDep[1];
    dep = depCodeOf(mDep[2]);
  }

  const collect = (nameQ: string): { c: Commune; s: number }[] => {
    const out: { c: Commune; s: number }[] = [];
    const seen = new Set<Commune>();
    const add = (c: Commune, bonus: number) => {
      if (seen.has(c)) return;
      if (dep && c.dep !== dep) return;
      if (cp && !c.cps.includes(cp)) return;
      seen.add(c);
      out.push({ c, s: bonus + Math.log10(c.pop + 10) + (c.metro ? 0.3 : 0) });
    };
    for (let i = lowerBound(d.sortedKeys, nameQ); i < d.sortedKeys.length && d.sortedKeys[i].startsWith(nameQ); i++) {
      const c = d.communes[d.sortedIdx[i]];
      add(c, c.key === nameQ ? 2 : c.key.startsWith(`${nameQ} `) ? 0.7 : 0.5);
    }
    const alias = d.aliases.get(nameQ);
    if (alias) add(alias.commune, 2.5);
    if (out.length < limit && nameQ.length >= 3) {
      const inner = ` ${nameQ}`;
      for (const c of d.communes) if (c.key.includes(inner)) add(c, 0);
    }
    return out;
  };
  let scored = collect(name);
  if (!scored.length && (dep || cp)) {
    dep = null;
    cp = null;
    scored = collect(q);
  }
  return pick(scored, limit);
}

/** Meilleures suggestions, communes non géolocalisées écartées en dernier (elles ne peuvent pas être ville de référence). */
function pick(scored: { c: Commune; s: number }[], limit: number): CommuneSuggestion[] {
  const out: CommuneSuggestion[] = [];
  for (const { c } of scored.sort((a, b) => b.s - a.s)) {
    if (out.length >= limit) break;
    if (located(c)) out.push(toSuggestion(c));
  }
  return out;
}

/** Texte libre (ex. profile.location « Lyon, France », « 92100 Boulogne ») → meilleure commune française, ou null. */
export function resolveHomeText(text: string): CommuneSuggestion | null {
  const t = (text ?? "").trim();
  if (!t) return null;
  const r = resolveText(t, null, false);
  if (r.lat === null || !r.code) return null;
  if (r.precision !== "commune" && r.precision !== "arrondissement" && r.precision !== "homonyme") return null;
  return communeByCode(r.code);
}
