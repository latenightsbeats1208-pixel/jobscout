import { DEPARTEMENTS, REGIONS, type SearchArea } from "./fr";
import COMMUNES from "./communes-fr.json";

/**
 * Situer une offre en France à partir de son lieu tel que la source l'écrit,
 * et la comparer à la zone de recherche. Mesuré sur 12 profils (octobre 2026) :
 * Welcome to the Jungle et LinkedIn ne filtrent pas par zone, et leurs offres
 * à l'autre bout du pays occupaient le haut de la liste — une infirmière de
 * Lyon voyait d'abord Cherbourg et Colmar.
 *
 * Formes rencontrées : « Lyon », « LYON 01 », « Lyon 8e Arrondissement »,
 * « Paris 15e », « STE FOY LES LYON », « Lyon et périphérie », « 76 »,
 * « Hauts-de-France », « Région métropolitaine de Paris », « Paris,
 * Île-de-France, France ». Un lieu introuvable n'est pas situé : il ne coûte rien.
 */

export type Located = {
  dept: string | null;
  region: string | null;
  /** Homonymes (« Saint-Denis » : 93 et 974) : tous les départements possibles. */
  candidates?: string[];
};

const key = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const regionOfDept = new Map(DEPARTEMENTS.map((d) => [d.code, d.region]));
const deptByName = new Map(DEPARTEMENTS.map((d) => [key(d.name), d.code]));
const regionByName = new Map(REGIONS.map((r) => [key(r.name), r.code]));
// Variantes courantes des noms de région.
for (const [alias, code] of [["ile de france", "11"], ["idf", "11"], ["paca", "93"], ["auvergne rhone alpes", "84"], ["region parisienne", "11"]] as const) {
  regionByName.set(alias, code);
}

/** Commune → département(s) : un nom porté dans plusieurs départements les garde tous. */
const communeDepts = new Map<string, string[]>();
for (const [dept, names] of Object.entries(COMMUNES as Record<string, string>)) {
  for (const name of names.split("|")) {
    const list = communeDepts.get(name);
    if (list) list.push(dept);
    else communeDepts.set(name, [dept]);
  }
}

const DEPT_CODE = /^(?:\d{2,3}|2[ab])$/;

function cleanCity(part: string): string {
  return key(part)
    .replace(/^region metropolitaine de /, "")
    .replace(/ et peripherie$/, "")
    .replace(/ cedex( \d+)?$/, "")
    // Arrondissements : « lyon 8e arrondissement », « paris 15e », « lyon 01 ».
    .replace(/ (?:\d{1,2})(?: ?(?:e|er|eme))?(?: arrondissement)?$/, "")
    .replace(/^st /, "saint ")
    .replace(/^ste /, "sainte ")
    .replace(/ st /g, " saint ")
    .replace(/ ste /g, " sainte ");
}

/** Département et région d'un lieu français ; null quand on ne sait pas. */
export function locateFr(location: string | null | undefined): Located | null {
  if (!location?.trim()) return null;
  // Code entre parenthèses ou en fin : « Saint-Nazaire - 44 », « Le Grand-Quevilly (76) ».
  const code = location.match(/\((\d{2,3}|2[AB])\)|(?:^|\s-\s)(\d{2,3}|2[AB])(?:\s|$)/i);
  const coded = (code?.[1] ?? code?.[2])?.toUpperCase();
  if (coded && regionOfDept.has(coded)) return { dept: coded, region: regionOfDept.get(coded)! };

  for (const part of location.split(/,|\s-\s/)) {
    const k = key(part);
    if (!k || k === "france") continue;
    if (DEPT_CODE.test(k) && regionOfDept.has(k.toUpperCase())) return { dept: k.toUpperCase(), region: regionOfDept.get(k.toUpperCase())! };
    const dept = deptByName.get(k);
    if (dept) return { dept, region: regionOfDept.get(dept)! };
    const region = regionByName.get(k);
    if (region) return { dept: null, region };
    const depts = communeDepts.get(cleanCity(part));
    if (depts?.length === 1) return { dept: depts[0], region: regionOfDept.get(depts[0]) ?? null };
    if (depts && depts.length > 1) {
      // Homonymes : même région pour tous, on sait au moins la région.
      const regions = new Set(depts.map((d) => regionOfDept.get(d)));
      return { dept: null, region: regions.size === 1 ? [...regions][0] ?? null : null, candidates: depts };
    }
  }
  return null;
}

/** Télétravail complet : le lieu de l'offre ne contraint plus personne. */
const FULL_REMOTE =
  /(?:100\s?%|full|fully|totalement|entierement|complet)\s*(?:en\s+)?(?:remote|teletravail|a distance)|(?:remote|teletravail)\s*(?:100\s?%|complet|total)|\bfull[- ]remote\b|\bremote[- ]first\b/;

export type ZoneFit = {
  /** « dans » la zone, « proche » (même région), « hors » zone, ou null (lieu inconnu, zone non définie, étranger). */
  fit: "dans" | "proche" | "hors" | null;
  /** Libellé du lieu pour la raison affichée. */
  place: string | null;
};

export function zoneFit(
  area: SearchArea | null,
  offer: { location?: string | null; country?: string | null; title: string; description_text: string }
): ZoneFit {
  const none: ZoneFit = { fit: null, place: null };
  if (!area) return none;
  // La zone ne vaut que pour la France.
  if (offer.country && key(offer.country) !== "france") return none;
  const text = key(`${offer.title} ${offer.location ?? ""} ${offer.description_text.slice(0, 3000)}`);
  if (FULL_REMOTE.test(text)) return none;
  const loc = locateFr(offer.location);
  if (!loc) return none;
  const place = offer.location!.trim();
  if (area.kind === "region") {
    if (loc.region === area.code || loc.candidates?.some((d) => regionOfDept.get(d) === area.code)) return { fit: "dans", place };
    return loc.region ? { fit: "hors", place } : none;
  }
  if (loc.dept === area.code || loc.candidates?.includes(area.code)) return { fit: "dans", place };
  const areaRegion = regionOfDept.get(area.code);
  if (loc.region && loc.region === areaRegion) return { fit: "proche", place };
  if (loc.candidates?.some((d) => regionOfDept.get(d) === areaRegion)) return { fit: "proche", place };
  return loc.region || loc.dept ? { fit: "hors", place } : none;
}
