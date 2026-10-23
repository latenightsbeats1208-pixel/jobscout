#!/usr/bin/env node
// Construit la base géographique HORS LIGNE de JobScout (filtre « distance »).
//
//   node scripts/build-geo.mjs <dossier des sources> [dossier de sortie]
//
// Le dossier de sortie vaut lib/geo/data par défaut ; en indiquer un autre
// permet de comparer une nouvelle construction aux fichiers en place avant de
// les remplacer.
//
// Sources attendues dans le dossier (téléchargées à part, jamais par ce script) :
//   communes.json             https://geo.api.gouv.fr/communes?type=commune-actuelle,arrondissement-municipal&fields=nom,code,codesPostaux,centre,codeDepartement,population&format=json
//                             Les deux paramètres sont nécessaires : sans
//                             `fields`, l'API ne renvoie pas `centre` (toutes
//                             les communes seraient ignorées) ; sans `type`,
//                             pas les arrondissements municipaux. La zone par
//                             défaut couvre déjà métropole, outre-mer et
//                             collectivités d'outre-mer (documentation :
//                             https://geo.api.gouv.fr/decoupage-administratif)
//                             — l'API n'indique aucune licence pour les
//                             données qu'elle sert ; elles viennent de :
//                             INSEE (COG, populations légales) et La Poste
//                             (codes postaux), Licence Ouverte 2.0 pour leurs
//                             propres données ; centres calculés par l'API à
//                             partir du jeu « Contours administratifs »
//                             d'Etalab (data.gouv.fr), sous ODbL : contours
//                             d'ADMIN EXPRESS (IGN) pour la métropole, d'un
//                             jeu publié pour
//                             chacune pour la Polynésie française et la
//                             Nouvelle-Calédonie, d'OpenStreetMap pour les
//                             autres collectivités d'outre-mer (producteurs :
//                             THIRD_PARTY_NOTICES.txt).
//                             Les centres des communes de six collectivités
//                             d'outre-mer sont retirés : voir NON_GEOLOCALISEES.
//   departements.json         https://geo.api.gouv.fr/departements (champs nom,
//                             code, codeRegion) — noms et codes : INSEE (COG),
//                             Licence Ouverte 2.0
//   cities1000.zip            https://download.geonames.org/export/dump/cities1000.zip
//                             — GeoNames, CC BY 4.0
//   countryInfo.txt           https://download.geonames.org/export/dump/countryInfo.txt
//                             — GeoNames, CC BY 4.0 (noms anglais des pays)
//   v_pays_territoire_2026.csv https://www.insee.fr/fr/information/8740222
//                             (COG 2026, pays et territoires étrangers)
//                             — INSEE, Licence Ouverte 2.0 (noms français)
//
// Le contrôle « exactement 45 arrondissements municipaux » ci-dessous vérifie
// que communes.json contient bien les arrondissements.
//
// Produit lib/geo/data/geo-fr.json.gz et lib/geo/data/geo-world.json.gz
// (JSON compact en tableaux, coordonnées à 4 décimales, clés de recherche
// pré-normalisées par lib/geo/normalize.mjs). Sort en code 1 si un contrôle
// échoue : rien n'est écrit tant que tous les contrôles ne sont pas passés.
//
// Licences des fichiers produits (détail : THIRD_PARTY_NOTICES.txt) :
//   geo-fr.json.gz     base de données mise à disposition sous Open Database
//                      License (ODbL) 1.0 — https://opendatacommons.org/licenses/odbl/1-0/
//                      (elle contient des informations issues du jeu
//                      « Contours administratifs », sous ODbL). Ce script est
//                      la méthode de construction de cette base dérivée
//                      (ODbL 1.0, article 4.6).
//   geo-world.json.gz  GeoNames (CC BY 4.0, données modifiées) et INSEE
//                      (Licence Ouverte 2.0) ; aucune donnée du jeu
//                      « Contours administratifs ».

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import { normalize, NORM_VERSION } from "../lib/geo/normalize.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

const srcDir = process.argv[2];
if (!srcDir) {
  console.error("Usage : node scripts/build-geo.mjs <dossier des sources> [dossier de sortie]");
  process.exit(1);
}
const OUT_DIR = process.argv[3] ? path.resolve(process.argv[3]) : path.join(ROOT, "lib", "geo", "data");

const failures = [];
function check(cond, msg) {
  if (!cond) failures.push(msg);
}
function fail(msg) {
  console.error(`ÉCHEC : ${msg}`);
  process.exit(1);
}
function readSrc(name) {
  const p = path.join(srcDir, name);
  if (!fs.existsSync(p)) fail(`source absente : ${p}`);
  return fs.readFileSync(p);
}
const r4 = (x) => Math.round(Number(x) * 1e4) / 1e4;

// ---------------------------------------------------------------- France

const communesSrc = JSON.parse(readSrc("communes.json").toString("utf8"));
const depsSrc = JSON.parse(readSrc("departements.json").toString("utf8"));

/** Arrondissements municipaux de Paris, Lyon, Marseille. */
function isArrondissement(code) {
  return /^751(0[1-9]|1\d|20)$/.test(code) || /^6938[1-9]$/.test(code) || /^132(0[1-9]|1[0-6])$/.test(code);
}

// Collectivités d'outre-mer NON géolocalisées : Saint-Pierre-et-Miquelon (975),
// Saint-Barthélemy (977), Saint-Martin (978), Terres australes et antarctiques
// françaises (984), Wallis-et-Futuna (986) et Clipperton (989). Pour leurs
// communes, l'API calcule le centre à partir de contours qui, d'après la
// description du jeu « Contours administratifs », viennent d'OpenStreetMap et
// non d'IGN ADMIN EXPRESS : leurs centres sont retirés (latitude et longitude
// nulles), comme tout point qui en dérive (barycentre de la collectivité, nul
// lui aussi, plus bas). Choix arrêté : ne pas le changer sans revoir
// THIRD_PARTY_NOTICES.txt, qui le décrit.
// Coordonnées nulles plutôt qu'entrée retirée : nom, code INSEE, codes postaux
// et population (INSEE, La Poste, Licence Ouverte) restent, si bien que le
// moteur (lib/geo/index.ts) reconnaît toujours ces communes et ces codes de
// collectivité, et rend l'offre « non placée » au lieu de la confondre avec un
// homonyme. Sans ces entrées (essai mesuré), « Saint-Pierre (975) » ou
// « 975 - ST PIERRE » iraient à Saint-Pierre (La Réunion), « Saint-Martin,
// France » au village des Hautes-Pyrénées, et « Saint-Barthélemy (56) » perdrait
// sa commune (le nom serait lu comme celui de la collectivité).
// La Polynésie française (987) et la Nouvelle-Calédonie (988) restent
// géolocalisées : d'après la description du jeu Etalab, leurs contours ne
// viennent ni d'IGN ADMIN EXPRESS ni d'OpenStreetMap, mais d'un jeu publié pour
// chacune (producteurs nommés dans THIRD_PARTY_NOTICES.txt).
const NON_GEOLOCALISEES = new Set(["975", "977", "978", "984", "986", "989"]);
/** Commune d'une collectivité non géolocalisée, par son département ou par le début de son code INSEE. */
const isNonGeolocalisee = (code, dep) => NON_GEOLOCALISEES.has(String(dep ?? "")) || NON_GEOLOCALISEES.has(String(code ?? "").slice(0, 3));

const communes = [];
const unlocated = [];
let skippedNoCentre = 0;
for (const c of communesSrc) {
  const coords = c?.centre?.coordinates;
  if (!Array.isArray(coords) || coords.length !== 2 || !c.code || !c.nom || !c.codeDepartement) {
    skippedNoCentre++;
    continue;
  }
  const hidden = isNonGeolocalisee(c.code, c.codeDepartement);
  if (hidden) unlocated.push(String(c.code));
  const [lng, lat] = coords;
  communes.push([
    String(c.code),
    String(c.nom),
    String(c.codeDepartement),
    (c.codesPostaux ?? []).map(String),
    hidden ? null : r4(lat),
    hidden ? null : r4(lng),
    Number(c.population ?? 0) || 0,
    normalize(c.nom),
  ]);
}
communes.sort((a, b) => a[0].localeCompare(b[0]));

const byCode = new Map(communes.map((c) => [c[0], c]));
check(communes.length >= 30000, `moins de 30 000 communes (${communes.length})`);
for (const [code, nom] of [
  ["75056", "Paris"],
  ["69123", "Lyon"],
  ["13055", "Marseille"],
  ["93066", "Saint-Denis"],
  ["97411", "Saint-Denis"],
  ["75111", "Paris 11e Arrondissement"],
  ["69383", "Lyon 3e Arrondissement"],
  ["13208", "Marseille 8e Arrondissement"],
  ["98735", "Papeete"],
  ["98818", "Nouméa"],
]) {
  const c = byCode.get(code);
  check(!!c && c[1] === nom, `commune ${code} (${nom}) absente ou renommée`);
}
// Chaque collectivité non géolocalisée doit avoir été trouvée dans la source
// (sinon ses codes ont changé et le retrait des centres ne s'applique peut-être
// plus), et seules ses communes sont sans centre.
for (const code of NON_GEOLOCALISEES) {
  check(unlocated.some((x) => x.startsWith(code)), `collectivité ${code} : aucune commune trouvée (codes changés ?)`);
}
check(
  communes.every((c) => (c[4] === null && c[5] === null) === isNonGeolocalisee(c[0], c[2])),
  "centre présent pour une commune non géolocalisée, ou absent pour une autre",
);
check(communes.filter((c) => isArrondissement(c[0])).length === 45, "il faut exactement 45 arrondissements municipaux");
const paris = byCode.get("75056");
check(!!paris && Math.abs(paris[4] - 48.86) < 0.05 && Math.abs(paris[5] - 2.35) < 0.05, "centre de Paris incohérent");
const sd93 = byCode.get("93066");
check(!!sd93 && sd93[2] === "93", "Saint-Denis 93066 n'est pas en Seine-Saint-Denis");

// Départements (+ collectivités d'outre-mer présentes dans les communes) :
// point = barycentre des communes pondéré par la population (arrondissements
// exclus pour ne pas compter Paris, Lyon et Marseille deux fois). Collectivité
// non géolocalisée (NON_GEOLOCALISEES) : nom et code gardés, point nul (il
// serait calculé à partir des centres retirés).
const COM_NAMES = {
  975: "Saint-Pierre-et-Miquelon",
  977: "Saint-Barthélemy",
  978: "Saint-Martin",
  984: "Terres australes et antarctiques françaises",
  986: "Wallis-et-Futuna",
  987: "Polynésie française",
  988: "Nouvelle-Calédonie",
  989: "Île de Clipperton",
};
const depDefs = depsSrc.map((d) => ({ code: String(d.code), nom: String(d.nom), region: String(d.codeRegion ?? "") }));
for (const [code, nom] of Object.entries(COM_NAMES)) {
  if (!depDefs.some((d) => d.code === code)) depDefs.push({ code, nom, region: "" });
}
const deps = [];
for (const d of depDefs) {
  const members = communes.filter((c) => c[2] === d.code && !isArrondissement(c[0]));
  if (members.length === 0) {
    check(!/^\d\d$|^2[AB]$|^97[1-6]$/.test(d.code), `département ${d.code} sans commune`);
    continue;
  }
  if (NON_GEOLOCALISEES.has(d.code)) {
    deps.push([d.code, d.nom, null, null, d.region, normalize(d.nom)]);
    continue;
  }
  let w = 0;
  let sx = 0;
  let sy = 0;
  for (const c of members) {
    const p = c[6] > 0 ? c[6] : 1;
    w += p;
    sx += c[4] * p;
    sy += c[5] * p;
  }
  deps.push([d.code, d.nom, r4(sx / w), r4(sy / w), d.region, normalize(d.nom)]);
}
check(deps.length >= 101, `moins de 101 départements (${deps.length})`);
check(
  deps.every((d) => (d[2] === null && d[3] === null) === NON_GEOLOCALISEES.has(d[0])) && deps.every((d) => d[2] === null || Number.isFinite(d[2])),
  "point calculé pour une collectivité non géolocalisée, ou département sans point",
);
check(["987", "988"].every((code) => deps.some((d) => d[0] === code && d[2] !== null)), "Polynésie française ou Nouvelle-Calédonie sans point");
const d78 = deps.find((d) => d[0] === "78");
check(!!d78 && d78[2] > 48.6 && d78[2] < 49.0 && d78[3] > 1.6 && d78[3] < 2.3, "barycentre des Yvelines incohérent");

// ---------------------------------------------------------------- Monde

/** Lit une entrée d'un ZIP (deflate ou stockée) sans dépendance. */
function unzipEntry(buf, wanted) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) fail("cities1000.zip : fin de répertoire ZIP introuvable");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) fail("cities1000.zip : répertoire central illisible");
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOff = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    if (name === wanted) {
      const lnl = buf.readUInt16LE(localOff + 26);
      const lel = buf.readUInt16LE(localOff + 28);
      const start = localOff + 30 + lnl + lel;
      const data = buf.subarray(start, start + csize);
      if (method === 0) return data;
      if (method === 8) return zlib.inflateRawSync(data);
      fail(`cities1000.zip : méthode de compression ${method} non gérée`);
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  fail(`cities1000.zip : entrée ${wanted} absente`);
}

// Territoires français, exclus des villes du monde : couverts par les communes
// françaises (DROM, Polynésie française, Nouvelle-Calédonie), ou volontairement
// non géolocalisés (PM, BL, MF, WF, TF : voir NON_GEOLOCALISEES), sans autre
// source de points pour eux.
const FR_TERRITORIES = new Set(["FR", "GP", "MQ", "GF", "RE", "YT", "PM", "BL", "MF", "WF", "PF", "NC", "TF"]);
// Pays où l'on garde toutes les localités de cities1000 (offres frontalières).
const SMALL_PLACES = new Set(["LU", "CH", "BE", "MC", "AD"]);
const MIN_POP = 15000;

// Noms français usuels de villes étrangères (libellé affiché) ;
// clé = « code pays|nom GeoNames ». Le nom GeoNames reste une clé de recherche.
const EXONYMS = {
  "BE|Brussels": "Bruxelles",
  "BE|Antwerp": "Anvers",
  "BE|Gent": "Gand",
  "BE|Brugge": "Bruges",
  "BE|Leuven": "Louvain",
  "BE|Mechelen": "Malines",
  "BE|Kortrijk": "Courtrai",
  "BE|Aalst": "Alost",
  "BE|Ieper": "Ypres",
  "BE|Halle": "Hal",
  "BE|Tienen": "Tirlemont",
  "BE|Ronse": "Renaix",
  "BE|Sint-Niklaas": "Saint-Nicolas",
  "BE|Ostend": "Ostende",
  "BE|Hasselt": "Hasselt",
  "CH|Geneva": "Genève",
  "CH|Zürich": "Zurich",
  "CH|Basel": "Bâle",
  "CH|Bern": "Berne",
  "CH|Luzern": "Lucerne",
  "CH|Sankt Gallen": "Saint-Gall",
  "CH|Biel/Bienne": "Bienne",
  "CH|Schaffhausen": "Schaffhouse",
  "CH|Solothurn": "Soleure",
  "CH|Chur": "Coire",
  "CH|Zug": "Zoug",
  "CH|Thun": "Thoune",
  "GB|London": "Londres",
  "GB|Edinburgh": "Édimbourg",
  "DE|Köln": "Cologne",
  "DE|Aachen": "Aix-la-Chapelle",
  "DE|Frankfurt am Main": "Francfort-sur-le-Main",
  "DE|Hamburg": "Hambourg",
  "DE|Mainz": "Mayence",
  "DE|Trier": "Trèves",
  "DE|Saarbrücken": "Sarrebruck",
  "DE|Dresden": "Dresde",
  "DE|Munich": "Munich",
  "AT|Vienna": "Vienne",
  "PL|Warsaw": "Varsovie",
  "PL|Kraków": "Cracovie",
  "RU|Moscow": "Moscou",
  "RU|Saint Petersburg": "Saint-Pétersbourg",
  "IT|Venice": "Venise",
  "IT|Genoa": "Gênes",
  "IT|Milan": "Milan",
  "IT|Turin": "Turin",
  "IT|Naples": "Naples",
  "IT|Florence": "Florence",
  "ES|Barcelona": "Barcelone",
  "ES|Sevilla": "Séville",
  "ES|Valencia": "Valence",
  "ES|Zaragoza": "Saragosse",
  "PT|Lisbon": "Lisbonne",
  "GR|Athens": "Athènes",
  "DK|Copenhagen": "Copenhague",
  "NL|The Hague": "La Haye",
  "EG|Cairo": "Le Caire",
  "DZ|Algiers": "Alger",
  "MA|Marrakesh": "Marrakech",
  "MA|Fes": "Fès",
  "MA|Tangier": "Tanger",
  "MA|Meknes": "Meknès",
  "LB|Beirut": "Beyrouth",
  "CN|Beijing": "Pékin",
  "SG|Singapore": "Singapour",
  "IN|Mumbai": "Bombay",
  "US|New York City": "New York",
  "US|New Orleans": "La Nouvelle-Orléans",
  "US|Philadelphia": "Philadelphie",
  "MX|Mexico City": "Mexico",
  "ZA|Cape Town": "Le Cap",
  "KW|Kuwait City": "Koweït",
  "AE|Dubai": "Dubaï",
  "AE|Abu Dhabi": "Abou Dabi",
  "SA|Riyadh": "Riyad",
  "IR|Tehran": "Téhéran",
  "KR|Seoul": "Séoul",
  "VN|Hanoi": "Hanoï",
  "VN|Ho Chi Minh City": "Hô Chi Minh-Ville",
  "ET|Addis Ababa": "Addis-Abeba",
  "MU|Port Louis": "Port-Louis",
  "IL|Jerusalem": "Jérusalem",
  "CL|Santiago": "Santiago du Chili",
  "CO|Bogotá": "Bogota",
  "LU|Luxembourg": "Luxembourg",
  "TN|Tunis": "Tunis",
};

/** Garde un nom alternatif seulement s'il est en alphabet latin, sans chiffre,
 * et ressemble à un nom propre (pas un code IATA ni une romanisation en minuscules). */
const LATIN = /^[\p{Script=Latin}\s'’.\-()]+$/u;
function keepAlt(a) {
  if (a.length < 3 || /\d/.test(a)) return false;
  if (!LATIN.test(a)) return false;
  if (a === a.toLowerCase()) return false; // romanisations « a bi rang », « jeneva »
  if (a.length <= 4 && a === a.toUpperCase()) return false; // codes « BRU », « NYC »
  if (/^(Lungsod ng|Bandar Raya|Cathair|Kota|Gemeente|Commune de|Stadt) /i.test(a)) return false;
  return true;
}

const citiesTxt = unzipEntry(readSrc("cities1000.zip"), "cities1000.txt").toString("utf8");
const cities = [];
const exonymUsed = new Set();
let rows = 0;
for (const line of citiesTxt.split("\n")) {
  if (!line) continue;
  rows++;
  const f = line.split("\t");
  const cc = f[8];
  const pop = Number(f[14] || 0);
  const fcode = f[7];
  if (f[6] !== "P" || FR_TERRITORIES.has(cc)) continue;
  if (fcode === "PPLH" || fcode === "PPLQ" || fcode === "PPLW") continue; // historique, abandonné, détruit
  const small = SMALL_PLACES.has(cc);
  if (!small && pop < MIN_POP) continue;
  const gname = f[1];
  const exo = EXONYMS[`${cc}|${gname}`];
  if (exo) exonymUsed.add(`${cc}|${gname}`);
  const display = exo ?? gname;
  const primary = new Set([normalize(display), normalize(gname), normalize(f[2])].filter(Boolean));
  const alts = new Set();
  if (small || pop >= MIN_POP) {
    for (const a of f[3].split(",")) {
      if (!a || !keepAlt(a)) continue;
      const k = normalize(a);
      if (k && !primary.has(k)) alts.add(k);
    }
  }
  cities.push([display, cc, r4(f[4]), r4(f[5]), pop, f[10] ?? "", [...primary].join("|"), [...alts].join("|")]);
}
cities.sort((a, b) => b[4] - a[4] || a[0].localeCompare(b[0]));
check(rows > 100000, `cities1000.txt trop court (${rows} lignes)`);
check(cities.length >= 30000, `moins de 30 000 villes (${cities.length})`);
const findCity = (cc, name) => cities.find((c) => c[1] === cc && c[0] === name);
for (const [cc, name] of [
  ["BE", "Bruxelles"],
  ["CH", "Genève"],
  ["LU", "Luxembourg"],
  ["CI", "Abidjan"],
  ["CA", "Montréal"],
  ["MC", "Monaco"],
  ["TN", "Tunis"],
  ["LU", "Bertrange"],
]) {
  check(!!findCity(cc, name), `ville ${name} (${cc}) absente`);
}
for (const k of Object.keys(EXONYMS)) {
  if (!exonymUsed.has(k)) console.warn(`avertissement : exonyme sans correspondance GeoNames : ${k}`);
}

// ---------------------------------------------------------------- Pays

function parseCsv(text) {
  const out = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const cells = [];
    let cur = "";
    let q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (q) {
        if (ch === '"' && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else if (ch === '"') q = false;
        else cur += ch;
      } else if (ch === '"') q = true;
      else if (ch === ",") {
        cells.push(cur);
        cur = "";
      } else cur += ch;
    }
    cells.push(cur);
    out.push(cells);
  }
  return out;
}

const countries = new Map(); // iso2 -> { nom, keys:Set }
function addCountry(iso, nom) {
  if (!iso) return;
  if (!countries.has(iso)) countries.set(iso, { nom, keys: new Set() });
  const c = countries.get(iso);
  if (nom && !c.nom) c.nom = nom;
  return c;
}
function addKey(iso, name) {
  const c = countries.get(iso) ?? addCountry(iso, "");
  const k = normalize(name);
  if (k) c.keys.add(k);
}

const insee = parseCsv(readSrc("v_pays_territoire_2026.csv").toString("utf8"));
const header = insee[0];
const col = (n) => header.indexOf(n);
for (const r of insee.slice(1)) {
  const iso = r[col("CODEISO2")];
  if (!iso) continue;
  addCountry(iso, r[col("LIBCOG")]);
  addKey(iso, r[col("LIBCOG")]);
  addKey(iso, r[col("LIBENR")]);
}
for (const line of readSrc("countryInfo.txt").toString("utf8").split(/\r?\n/)) {
  if (!line || line.startsWith("#")) continue;
  const f = line.split("\t");
  const iso = f[0];
  if (!/^[A-Z]{2}$/.test(iso)) continue;
  addCountry(iso, "");
  addKey(iso, f[4]); // nom anglais
  // Pas de clé ISO3 : « MAR », « PER », « CAN », « BEL »… captureraient des segments ordinaires.
  if (!countries.get(iso).nom) countries.get(iso).nom = f[4];
}

// Noms français des territoires français (absents de la liste INSEE des pays)
// et alias usuels FR/EN/locaux des noms de pays.
const FR_TERRITORY_NAMES = {
  FR: "France",
  GP: "Guadeloupe",
  MQ: "Martinique",
  GF: "Guyane",
  RE: "La Réunion",
  YT: "Mayotte",
  PM: "Saint-Pierre-et-Miquelon",
  BL: "Saint-Barthélemy",
  MF: "Saint-Martin",
  WF: "Wallis-et-Futuna",
  PF: "Polynésie française",
  NC: "Nouvelle-Calédonie",
  TF: "Terres australes et antarctiques françaises",
  XK: "Kosovo",
};
for (const [iso, nom] of Object.entries(FR_TERRITORY_NAMES)) {
  const c = addCountry(iso, nom);
  c.nom = nom;
  addKey(iso, nom);
}
const COUNTRY_ALIASES = {
  FR: ["République française", "France métropolitaine", "Frankreich", "Francia", "Frankrijk"],
  US: ["États-Unis", "Etats Unis", "États-Unis d’Amérique", "USA", "U.S.A.", "United States", "United States of America", "America"],
  GB: ["Royaume-Uni", "UK", "U.K.", "United Kingdom", "Great Britain", "Grande-Bretagne", "England", "Angleterre", "Scotland", "Écosse", "Wales", "Pays de Galles"],
  CI: ["Côte d’Ivoire", "Côte d'Ivoire", "Cote d Ivoire", "Ivory Coast", "RCI"],
  CG: ["République du Congo", "Congo-Brazzaville", "Congo Brazzaville", "Republic of the Congo", "Congo (Brazzaville)"],
  CD: ["République démocratique du Congo", "RDC", "RD Congo", "Congo-Kinshasa", "Congo Kinshasa", "Democratic Republic of the Congo", "DR Congo", "DRC"],
  HK: ["Hong Kong", "Hong-Kong", "Hong Kong SAR", "Région administrative spéciale de Hong Kong"],
  MO: ["Macao", "Macau"],
  CH: ["Suisse", "Schweiz", "Svizzera", "Switzerland", "Swiss", "Confédération suisse"],
  BE: ["Belgique", "Belgium", "België", "Belgie", "Belgien", "Kingdom of Belgium", "Royaume de Belgique"],
  LU: ["Luxembourg", "Luxemburg", "Lëtzebuerg", "Grand-Duché de Luxembourg", "Grand Duchy of Luxembourg"],
  DE: ["Allemagne", "Deutschland", "Germany"],
  NL: ["Pays-Bas", "Nederland", "Netherlands", "Holland", "Hollande"],
  ES: ["Espagne", "España", "Spain"],
  IT: ["Italie", "Italia", "Italy"],
  AT: ["Autriche", "Österreich", "Austria"],
  MA: ["Maroc", "Morocco", "Marokko", "Royaume du Maroc"],
  TN: ["Tunisie", "Tunisia"],
  DZ: ["Algérie", "Algeria"],
  SN: ["Sénégal", "Senegal"],
  AE: ["Émirats arabes unis", "EAU", "UAE", "United Arab Emirates", "Emirats"],
  KR: ["Corée du Sud", "South Korea", "Korea", "Corée"],
  CZ: ["Tchéquie", "République tchèque", "Czech Republic", "Czechia"],
  TR: ["Turquie", "Türkiye", "Turkey"],
  CF: ["Centrafrique", "République centrafricaine", "Central African Republic", "RCA"],
  MU: ["Maurice", "Île Maurice", "Ile Maurice", "Mauritius"],
  DO: ["République dominicaine", "Dominican Republic"],
  VN: ["Vietnam", "Viet Nam", "Viêt Nam"],
  RU: ["Russie", "Russia", "Fédération de Russie"],
  MK: ["Macédoine du Nord", "North Macedonia", "Macédoine"],
  SZ: ["Eswatini", "Swaziland"],
  MM: ["Birmanie", "Myanmar"],
  CV: ["Cap-Vert", "Cabo Verde", "Cape Verde"],
  VA: ["Vatican", "Saint-Siège"],
  PS: ["Palestine", "Territoires palestiniens"],
  TW: ["Taïwan", "Taiwan"],
  BR: ["Brésil", "Brasil", "Brazil"],
  PL: ["Pologne", "Polska", "Poland"],
  SE: ["Suède", "Sverige", "Sweden"],
  NO: ["Norvège", "Norge", "Norway"],
  DK: ["Danemark", "Danmark", "Denmark"],
  FI: ["Finlande", "Suomi", "Finland"],
  IE: ["Irlande", "Éire", "Ireland"],
  GR: ["Grèce", "Greece", "Hellas"],
  PT: ["Portugal"],
  MX: ["Mexique", "México", "Mexico"],
  EC: ["Équateur", "Ecuador"],
  PE: ["Pérou", "Peru", "Perú"],
  CO: ["Colombie", "Colombia"],
  CL: ["Chili", "Chile"],
  AR: ["Argentine", "Argentina"],
  CA: ["Canada"],
  JP: ["Japon", "Japan"],
  CN: ["Chine", "China"],
  IN: ["Inde", "India"],
  SG: ["Singapour", "Singapore"],
  ZA: ["Afrique du Sud", "South Africa"],
  CM: ["Cameroun", "Cameroon"],
  BJ: ["Bénin", "Benin"],
  BF: ["Burkina Faso", "Burkina"],
  GN: ["Guinée", "Guinea", "Guinée Conakry"],
  MR: ["Mauritanie", "Mauritania"],
  TD: ["Tchad", "Chad"],
  ET: ["Éthiopie", "Ethiopia"],
  LB: ["Liban", "Lebanon"],
  JO: ["Jordanie", "Jordan"],
  SA: ["Arabie saoudite", "Saudi Arabia"],
  EG: ["Égypte", "Egypt"],
  IQ: ["Irak", "Iraq"],
  KW: ["Koweït", "Kuwait"],
  BH: ["Bahreïn", "Bahrain"],
  QA: ["Qatar"],
  HU: ["Hongrie", "Hungary", "Magyarország"],
  RO: ["Roumanie", "Romania", "România"],
  HR: ["Croatie", "Croatia", "Hrvatska"],
  AU: ["Australie", "Australia"],
  NZ: ["Nouvelle-Zélande", "New Zealand"],
  TH: ["Thaïlande", "Thailand"],
  MY: ["Malaisie", "Malaysia"],
  ID: ["Indonésie", "Indonesia"],
  PH: ["Philippines"],
  KH: ["Cambodge", "Cambodia"],
  MC: ["Monaco", "Principauté de Monaco"],
  AD: ["Andorre", "Andorra"],
};
for (const [iso, names] of Object.entries(COUNTRY_ALIASES)) for (const n of names) addKey(iso, n);

// Libellés affichés : la forme INSEE courte n'est pas toujours la forme usuelle
// (« Burkina », « Swaziland »), et les territoires que l'INSEE regroupe
// (« Territoires britanniques en Méditerranée ») gardent leur propre nom.
const DISPLAY = {
  BF: "Burkina Faso",
  SZ: "Eswatini",
  GI: "Gibraltar",
  SH: "Sainte-Hélène",
  AS: "Samoa américaines",
  BM: "Bermudes",
  KY: "Îles Caïmans",
  PR: "Porto Rico",
  VI: "Îles Vierges des États-Unis",
  VG: "Îles Vierges britanniques",
  FK: "Îles Malouines",
  IM: "Île de Man",
  GG: "Guernesey",
  JE: "Jersey",
  MP: "Îles Mariannes du Nord",
  TC: "Îles Turques-et-Caïques",
  CK: "Îles Cook",
  MH: "Îles Marshall",
  SB: "Îles Salomon",
  FO: "Îles Féroé",
  BZ: "Belize",
  CC: "Îles Cocos",
  CX: "Île Christmas",
  NF: "Île Norfolk",
  UM: "Îles mineures éloignées des États-Unis",
  SJ: "Svalbard et Jan Mayen",
  HM: "Îles Heard-et-MacDonald",
  BV: "Île Bouvet",
  GS: "Géorgie du Sud-et-les îles Sandwich du Sud",
};
for (const [iso, nom] of Object.entries(DISPLAY)) {
  const c = addCountry(iso, nom);
  c.nom = nom;
  addKey(iso, nom);
}
countries.delete("AN"); // Antilles néerlandaises, dissoutes en 2010
countries.delete("CS"); // Serbie-et-Monténégro, dissoute en 2006

// Une clé ne doit désigner qu'un pays : en cas de conflit, la première
// attribution manuelle l'emporte et on signale le doublon.
const keyOwner = new Map();
for (const [iso, names] of Object.entries(COUNTRY_ALIASES)) {
  for (const n of names) {
    const k = normalize(n);
    if (!keyOwner.has(k)) keyOwner.set(k, iso);
  }
}
for (const [iso, c] of countries) {
  for (const k of c.keys) {
    const owner = keyOwner.get(k);
    if (owner && owner !== iso) {
      c.keys.delete(k);
      continue;
    }
    if (!owner) keyOwner.set(k, iso);
  }
}
const countriesOut = [...countries.entries()]
  .filter(([, c]) => c.nom)
  .map(([iso, c]) => [iso, c.nom, [...c.keys].join("|")])
  .sort((a, b) => a[0].localeCompare(b[0]));
check(countriesOut.length >= 200, `moins de 200 pays (${countriesOut.length})`);
const countryOf = (name) => keyOwner.get(normalize(name));
for (const [name, iso] of [
  ["États-Unis", "US"],
  ["USA", "US"],
  ["United States", "US"],
  ["Royaume-Uni", "GB"],
  ["UK", "GB"],
  ["Côte d’Ivoire", "CI"],
  ["Côte d'Ivoire", "CI"],
  ["République du Congo", "CG"],
  ["Congo", "CG"],
  ["République démocratique du Congo", "CD"],
  ["Hong Kong", "HK"],
  ["Belgique", "BE"],
  ["Suisse", "CH"],
  ["Ecuador", "EC"],
  ["Bénin", "BJ"],
]) {
  check(countryOf(name) === iso, `pays « ${name} » non reconnu comme ${iso} (obtenu ${countryOf(name)})`);
}

// ---------------------------------------------------------------- Écriture

if (failures.length) {
  for (const f of failures) console.error(`ÉCHEC : ${f}`);
  console.error(`${failures.length} contrôle(s) en échec, aucun fichier écrit.`);
  process.exit(1);
}

const generated = new Date().toISOString().slice(0, 10);
const fr = {
  v: 1,
  normVersion: NORM_VERSION,
  generated,
  sources:
    "Base de données mise à disposition sous Open Database License (ODbL) 1.0 — https://opendatacommons.org/licenses/odbl/1-0/. Contient des informations issues du jeu « Contours administratifs » (Etalab, data.gouv.fr), disponible sous ODbL : centres des communes calculés par geo.api.gouv.fr à partir de ces contours, issus d'ADMIN EXPRESS (IGN) pour la métropole, du jeu « Géographie administrative de la Polynésie française » (data.gouv.fr) pour la Polynésie française et du jeu « Limites de provinces et des communes de Nouvelle-Calédonie » (DTSI-SGT, georep) pour la Nouvelle-Calédonie. Communes, codes INSEE et populations : INSEE (COG, populations légales) ; codes postaux : La Poste ; obtenus par geo.api.gouv.fr, Licence Ouverte 2.0 pour leurs propres données. Données modifiées (champs choisis, coordonnées arrondies à 4 décimales, clés de recherche normalisées, barycentres de département calculés) ; méthode de construction : scripts/build-geo.mjs ; détail : THIRD_PARTY_NOTICES.txt. Communes de Saint-Pierre-et-Miquelon, Saint-Barthélemy, Saint-Martin, des Terres australes et antarctiques françaises, de Wallis-et-Futuna et de Clipperton non géolocalisées (sans centre).",
  // [code INSEE, nom, département, codes postaux, lat, lng, population, clé normalisée]
  // (lat et lng nulles : commune non géolocalisée)
  communes,
  // [code, nom, lat, lng, région, clé normalisée] (lat et lng nulles : collectivité non géolocalisée)
  deps,
};
const world = {
  v: 1,
  normVersion: NORM_VERSION,
  generated,
  sources:
    "GeoNames (www.geonames.org, CC BY 4.0, données modifiées) ; INSEE, pays et territoires étrangers 2026 — Licence Ouverte",
  // [nom affiché, pays ISO2, lat, lng, population, code admin1, clés principales « | », clés alternatives « | »]
  cities,
  // [ISO2, nom français, clés « | »]
  countries: countriesOut,
};

fs.mkdirSync(OUT_DIR, { recursive: true });
for (const [name, obj] of [
  ["geo-fr.json.gz", fr],
  ["geo-world.json.gz", world],
]) {
  const json = Buffer.from(JSON.stringify(obj), "utf8");
  const gz = zlib.gzipSync(json, { level: 9 });
  fs.writeFileSync(path.join(OUT_DIR, name), gz);
  console.log(`${name} : ${(gz.length / 1048576).toFixed(2)} Mo (JSON ${(json.length / 1048576).toFixed(2)} Mo)`);
}
console.log(
  `communes ${communes.length} (dont 45 arrondissements, ${skippedNoCentre} sans centre ignorées, ${unlocated.length} non géolocalisées, centre retiré : ${unlocated.join(" ")}) · départements ${deps.length} · villes ${cities.length} · pays ${countriesOut.length}`,
);
console.log(`sortie : ${OUT_DIR}`);
