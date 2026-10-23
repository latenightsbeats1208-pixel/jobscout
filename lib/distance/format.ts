/**
 * Affichage des distances (client et serveur). Distances à vol d'oiseau, depuis le
 * centre de la commune : on arrondit pour ne pas promettre une précision qu'on n'a pas,
 * et le filtre compare la MÊME valeur arrondie (une offre affichée « 5 km » est dans
 * « Jusqu'à 5 km »).
 */

/** Rayons proposés par le filtre (km). 0 = « Dans ma ville ». */
export const DISTANCE_RADII = [0, 5, 10, 20, 30, 50, 100, 200] as const;

export type DistanceRadius = (typeof DISTANCE_RADII)[number];

export function isDistanceRadius(value: number): value is DistanceRadius {
  return (DISTANCE_RADII as readonly number[]).includes(value);
}

const numberFormat = new Intl.NumberFormat("fr-FR");

/** Distance telle qu'affichée : au km sous 100 km, à la dizaine sous 1 000 km, à la centaine au-delà. */
export function roundKm(km: number): number {
  if (km < 100) return Math.round(km);
  if (km < 1000) return Math.round(km / 10) * 10;
  return Math.round(km / 100) * 100;
}

/** « 3 km », « 260 km », « 1 200 km » ; « moins de 1 km » sous un demi-kilomètre. Espace insécable avant « km ». */
export function formatKm(km: number): string {
  const rounded = roundKm(km);
  return rounded < 1 ? "moins de 1\u00a0km" : `${numberFormat.format(rounded)}\u00a0km`;
}

/** Lieu approximatif : connu au département, ou commune devinée parmi des homonymes. */
export function isApproximate(precision: string | null): boolean {
  return precision === "departement" || precision === "homonyme";
}

/**
 * Libellé court d'une offre : « dans votre ville », « 12 km », « ≈ 25 km » (lieu
 * approximatif), « ≈ dans votre département », ou null si la distance est inconnue.
 */
export function distanceLabel(offer: { distance_km: number | null; same_city: boolean; same_dept?: boolean; geo_precision: string | null }): string | null {
  if (offer.same_city) return offer.geo_precision === "homonyme" ? "probablement dans votre ville" : "dans votre ville";
  if (offer.same_dept) return "≈ dans votre département";
  if (offer.distance_km === null) return null;
  return `${isApproximate(offer.geo_precision) ? "≈ " : ""}${formatKm(offer.distance_km)}`;
}

export function radiusLabel(radius: DistanceRadius): string {
  return radius === 0 ? "Dans ma ville" : `Jusqu'à ${radius} km`;
}

/** Département d'un code INSEE (« 69123 » → « 69 », « 97411 » → « 974 », « 2A004 » → « 2A »). */
export function depOfInsee(code: string): string {
  return code.startsWith("97") || code.startsWith("98") ? code.slice(0, 3) : code.slice(0, 2);
}
