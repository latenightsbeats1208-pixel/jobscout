import "server-only";
import { getSetting, setSetting } from "@/lib/db";
import { getProfile } from "@/lib/db/queries";
import { communeByCode, haversineKm, resolveHomeText, resolveOfferLocation, type CommuneSuggestion } from "@/lib/geo";
import { depOfInsee, distanceLabel, isApproximate } from "@/lib/distance/format";

/**
 * Ville de référence du filtre par distance.
 *
 * Réglage de l'application (table settings) et non champ du profil : profile.location
 * est le lieu écrit dans le CV, réutilisé par le CV et la lettre, et ne doit pas être
 * détourné. On ne stocke que le code INSEE de la commune : nom, codes postaux et
 * coordonnées sont relus dans la base géographique embarquée (lib/geo).
 */
const HOME_SETTING = "distance_home";

export type DistanceHome = CommuneSuggestion;

export function getDistanceHome(): DistanceHome | null {
  const raw = getSetting(HOME_SETTING);
  if (!raw) return null;
  try {
    const { code } = JSON.parse(raw) as { code?: unknown };
    return typeof code === "string" ? communeByCode(code) : null;
  } catch {
    return null;
  }
}

/** Enregistre la ville de référence (code INSEE), ou l'efface avec null. Lève une erreur si le code est inconnu. */
export function setDistanceHome(code: string | null): DistanceHome | null {
  if (!code) {
    setSetting(HOME_SETTING, "");
    return null;
  }
  const commune = communeByCode(code);
  if (!commune) throw new Error("Commune inconnue.");
  setSetting(HOME_SETTING, JSON.stringify({ code: commune.code }));
  return commune;
}

/** Commune proposée d'office à partir du lieu du profil (« Lyon, France »), à confirmer par l'utilisateur. */
export function suggestedDistanceHome(): DistanceHome | null {
  const location = getProfile()?.location?.trim();
  return location ? resolveHomeText(location) : null;
}

/** Arrondissements de Paris, Lyon et Marseille → commune entière (même règle que lib/db/offres.ts). */
function cityCode(code: string | null | undefined): string | null {
  if (!code) return null;
  if (/^751\d\d$/.test(code)) return "75056";
  if (/^6938\d$/.test(code)) return "69123";
  if (/^132\d\d$/.test(code)) return "13055";
  return code;
}

/**
 * Distance d'une offre (fiche détaillée) depuis la ville de référence : « dans votre
 * ville », « 12 km à vol d'oiseau », « distance inconnue », ou null sans ville choisie.
 */
export type OfferDistanceParts = { label: string; from: string | null; place: string | null };

export function offerDistanceText(offre: { source: string; location: string | null; country: string | null; company: string | null; raw_payload: string | null; description_text: string | null }): OfferDistanceParts | null {
  const home = getDistanceHome();
  if (!home) return null;
  let hint: string | null = null;
  try {
    const raw = offre.raw_payload ? (JSON.parse(offre.raw_payload) as Record<string, unknown>) : null;
    const value = offre.source === "apec" ? raw?.lieuTexte : offre.source === "wttj" ? raw?.remote : null;
    hint = typeof value === "string" ? value : null;
    // France Travail : département glissé dans le champ entreprise (« 974 »), comme dans la liste.
    const company = (offre.company ?? "").trim();
    if (offre.source === "francetravail" && /^(\d{2,3}|2[AB])$/.test(company)) hint = company;
  } catch {
    hint = null;
  }
  const geo = resolveOfferLocation({
    source: offre.source, location: offre.location, country: offre.country, hint,
    head: offre.source === "talent" ? (offre.description_text ?? "").slice(0, 400) : null,
  });
  if (geo.lat === null) return { label: "distance inconnue", from: null, place: null };
  const same = cityCode(geo.code) === cityCode(home.code);
  const sameDept = !same && geo.precision === "departement" && geo.code === depOfInsee(home.code);
  const label = distanceLabel({ distance_km: haversineKm(home, geo), same_city: same, same_dept: sameDept, geo_precision: geo.precision });
  // Lieu reconnu montré quand il est approximatif ou absent du texte de l'offre : une erreur se voit.
  const place = isApproximate(geo.precision) ? `${geo.label} ?` : !offre.location ? geo.label : null;
  if (same || sameDept) return { label: label ?? "", from: null, place };
  return { label: `${label} à vol d’oiseau`, from: `de ${home.label}`, place };
}
