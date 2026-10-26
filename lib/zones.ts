/**
 * Zones de recherche : où chercher (scan) et quelles offres garder (filtre
 * « Mes zones »). Catalogue fixe, sans dépendance serveur.
 *
 * - Centres et rayon : une offre placée à moins de `radiusKm` d'un centre est
 *   dans la zone (calcul local, lib/geo).
 * - `departements` : une offre française connue au seul département compte
 *   aussi, et France Travail est interrogé sur ces départements.
 * - `linkedin` / `talent` : lieux passés aux recherches de ces sites.
 */
export type ZoneId = "paris" | "lyon" | "romandie";

export type Zone = {
  id: ZoneId;
  label: string;
  /** Code ISO du pays. */
  country: "FR" | "CH";
  centers: { name: string; lat: number; lng: number }[];
  radiusKm: number;
  departements: string[];
  linkedin: string[];
  talent: string[];
};

export const ZONES: Record<ZoneId, Zone> = {
  paris: {
    id: "paris",
    label: "Paris et Île-de-France",
    country: "FR",
    centers: [{ name: "Paris", lat: 48.8566, lng: 2.3522 }],
    radiusKm: 45,
    departements: ["75", "92", "93", "94", "77", "78", "91", "95"],
    linkedin: ["Île-de-France, France"],
    talent: ["Paris"],
  },
  lyon: {
    id: "lyon",
    label: "Lyon et agglomération",
    country: "FR",
    centers: [{ name: "Lyon", lat: 45.764, lng: 4.8357 }],
    radiusKm: 30,
    departements: ["69"],
    linkedin: ["Lyon, Auvergne-Rhône-Alpes, France"],
    talent: ["Lyon"],
  },
  romandie: {
    id: "romandie",
    label: "Suisse romande",
    country: "CH",
    centers: [
      { name: "Genève", lat: 46.2044, lng: 6.1432 },
      { name: "Nyon", lat: 46.3833, lng: 6.2396 },
      { name: "Lausanne", lat: 46.5197, lng: 6.6323 },
      { name: "Montreux", lat: 46.4312, lng: 6.9107 },
      { name: "Yverdon-les-Bains", lat: 46.7785, lng: 6.6411 },
      { name: "Neuchâtel", lat: 46.992, lng: 6.931 },
      { name: "Fribourg", lat: 46.8065, lng: 7.162 },
      { name: "Sion", lat: 46.2331, lng: 7.3606 },
    ],
    radiusKm: 20,
    departements: [],
    linkedin: ["Geneva, Switzerland", "Lausanne, Vaud, Switzerland", "Neuchâtel, Switzerland", "Fribourg, Switzerland", "Sion, Valais, Switzerland"],
    talent: ["Genève", "Lausanne", "Neuchâtel", "Fribourg", "Sion"],
  },
};

export const ZONE_IDS = Object.keys(ZONES) as ZoneId[];

export function isZoneId(v: unknown): v is ZoneId {
  return typeof v === "string" && (ZONE_IDS as string[]).includes(v);
}

const EARTH_KM = 6371;
function km(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.sqrt(h));
}

/** L'offre (position résolue par lib/geo) est-elle dans l'une des zones ? */
export function inZones(
  geo: { lat: number | null; lng: number | null; precision: string | null; code: string | null },
  zones: Zone[]
): boolean {
  if (geo.lat !== null && geo.lng !== null) {
    // Offre connue au seul département : on compare le département, pas le centre du département.
    if (geo.precision === "departement") return zones.some((z) => !!geo.code && z.departements.includes(geo.code));
    const p = { lat: geo.lat, lng: geo.lng };
    return zones.some((z) => z.centers.some((c) => km(c, p) <= z.radiusKm));
  }
  return false;
}

/**
 * Lieux à interroger pour une source : ceux des zones, plus les pays ciblés
 * qu'aucune zone ne couvre (cherchés en entier, comme avant). Sans zone ni
 * pays : [""] (recherche sans lieu).
 */
export function searchLocations(
  countries: string[],
  zones: Zone[],
  field: "linkedin" | "talent",
  toCode: (country: string) => string | null
): { location: string; country: string | null }[] {
  const zoneCountries = new Set(zones.map((z) => z.country));
  const out: { location: string; country: string | null }[] = zones.flatMap((z) => z[field].map((location) => ({ location, country: z.country })));
  for (const c of countries) {
    const code = toCode(c);
    if (!code || !zoneCountries.has(code as Zone["country"])) out.push({ location: c, country: code });
  }
  return out.length ? out : [{ location: "", country: null }];
}
