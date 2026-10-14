import type { ProfileFull } from "@/lib/cv/types";
import { normalize, tokenize } from "./text";

/**
 * Expérience : celle du profil (déduite des dates) contre celle que l'offre
 * demande (dans sa description ou dans son titre).
 *
 * Le filtre est volontairement prudent : une offre n'est écartée que pour un
 * écart d'au moins trois ans, et quand l'annonce cite plusieurs durées, on
 * retient la plus faible. Écarter à tort une offre pertinente coûte plus cher
 * que d'en laisser passer une de trop.
 */

const PRESENT = /^(present|presente|aujourd'?hui|actuel|actuelle|current|now|ongoing|en cours)$/;

/** Mois écoulés depuis l'an 0 ; null si la date est illisible. */
function toMonths(raw: string | null | undefined, now: Date): number | null {
  if (!raw) return null;
  const s = normalize(raw.trim());
  if (PRESENT.test(s)) return now.getFullYear() * 12 + now.getMonth();
  let m = s.match(/^(\d{4})-(\d{1,2})/);
  if (m) return Number(m[1]) * 12 + Number(m[2]) - 1;
  m = s.match(/^(\d{1,2})\/(\d{4})$/);
  if (m) return Number(m[2]) * 12 + Number(m[1]) - 1;
  m = s.match(/^(\d{4})$/);
  if (m) return Number(m[1]) * 12;
  return null;
}

const TRAINEE = /\b(stage|stagiaire|intern|internship|alternance|alternant|apprenti|apprentie|apprentice|trainee)/;
/**
 * Emplois d'été ou de vacances : quelques mois par an, mais datés de janvier
 * à janvier dès que le CV ne donne que les années. « Vendeuse saisonnière,
 * étés 2022, 2023 et 2024 » devenait deux ans pleins, et une jeune diplômée
 * passait pour avoir 2,6 ans d'expérience (audit d'octobre 2026).
 */
// « été » seul est aussi un participe (« a été promu ») : il faut une année ou « job d'été ».
const SEASONAL = /\b(saisonniere?s?|saisonniers?|summer jobs?|summer (?:19|20)\d\d|jobs? d ete|etes? (?:19|20)\d\d|pendant les vacances|vacances scolaires)\b/;
/** Emploi d'étudiant ou à temps partiel : compte pour moitié, comme un stage. */
const PART_TIME = /\b(temps partiel|mi temps|job etudiant|pendant les etudes|part time|student job)\b/;

/** Poids d'une expérience dans les années comptées. */
function experienceWeight(e: { title: string; description?: string | null }): number {
  const text = normalize(`${e.title} ${e.description ?? ""}`).replace(/[^a-z0-9]+/g, " ");
  if (SEASONAL.test(text)) return 0.25;
  if (TRAINEE.test(normalize(e.title)) || PART_TIME.test(text)) return 0.5;
  return 1;
}

/**
 * Années d'expérience du profil. Les périodes qui se chevauchent ne comptent
 * qu'une fois ; un stage, une alternance ou un emploi à temps partiel compte
 * pour moitié, un emploi saisonnier pour un quart. null si aucune expérience
 * n'est datée — on ne filtre alors rien.
 */
export function profileExperienceYears(profile: ProfileFull, now = new Date()): number | null {
  const intervals: { start: number; end: number; weight: number }[] = [];
  const nowMonths = now.getFullYear() * 12 + now.getMonth();
  for (const e of profile.experiences) {
    const start = toMonths(e.start_date, now);
    if (start === null) continue;
    // Fin absente : on ne suppose pas un poste toujours en cours, on compte six mois.
    const end = Math.min(toMonths(e.end_date, now) ?? start + 6, nowMonths);
    if (end <= start) continue;
    intervals.push({ start, end, weight: experienceWeight(e) });
  }
  if (!intervals.length) return null;
  const from = Math.min(...intervals.map((i) => i.start));
  const to = Math.max(...intervals.map((i) => i.end));
  let months = 0;
  for (let m = from; m < to; m++) {
    let w = 0;
    for (const i of intervals) if (m >= i.start && m < i.end && i.weight > w) w = i.weight;
    months += w;
  }
  return Math.round((months / 12) * 10) / 10;
}

// ---------------------------------------------------------------------------
// Ce que l'offre demande
// ---------------------------------------------------------------------------

const EXP = String.raw`(?:d['’ ]?\s*|de\s+|of\s+)?(?:experience|exp\b|xp\b)`;
const RANGE = new RegExp(String.raw`\b(\d{1,2})\s*(?:a|-|–|to)\s*(\d{1,2})\s*(?:ans|annees|years?)\s*(?:minimum\s*)?${EXP}`, "g");
const YEARS_FR = new RegExp(String.raw`\b(\d{1,2})\s*\+?\s*(?:ans?|annees?)\s*(?:minimum\s*|min\.?\s*)?${EXP}`, "g");
const FR_AFTER = /\bexperience\s*(?:professionnelle\s*|significative\s*|reussie\s*|confirmee\s*)?(?:d['’]\s*au\s*moins|de\s*plus\s*de|minimum\s*de|minimale\s*de|d['’]\s*environ|de)\s*(\d{1,2})\s*(?:\+\s*)?(?:ans|annees)\b/g;
const YEARS_EN = /\b(\d{1,2})\s*\+?\s*(?:years?|yrs?)(?:\s+of)?(?:\s+(?:professional|relevant|hands-on|industry|proven|commercial|work|working))?\s+experience\b/g;
const AT_LEAST_EN = /\b(?:at least|minimum(?: of)?)\s*(\d{1,2})\s*\+?\s*years?\b/g;
const JUNIOR_FRIENDLY = /\b(debutante?s? accepte|debutante?s? bienvenue?s?|sans experience|premiere experience|jeunes? diplomee?s?|no (?:prior )?experience|entry[- ]level|new grad)/;

/** Durée d'expérience demandée par la description ; la plus faible si plusieurs sont citées. */
export function requiredYearsFromDescription(description: string): number | null {
  let text = normalize(description).replace(/\s+/g, " ");
  const found: number[] = [];
  // Une fourchette « 3 à 5 ans » compte pour sa borne basse, et ne doit pas
  // être relue ensuite comme « 5 ans d'expérience ».
  text = text.replace(RANGE, (_m, a: string, b: string) => {
    found.push(Math.min(Number(a), Number(b)));
    return " ";
  });
  for (const re of [YEARS_FR, FR_AFTER, YEARS_EN, AT_LEAST_EN]) {
    for (const m of text.matchAll(re)) found.push(Number(m[1]));
  }
  const plausible = found.filter((n) => n >= 1 && n <= 15);
  let years = plausible.length ? Math.min(...plausible) : null;
  if (JUNIOR_FRIENDLY.test(text)) years = years === null ? 0 : Math.min(years, 2);
  return years;
}

/** Niveau implicite du titre : « Senior » ≈ 5 ans, « Lead » ≈ 6, « Head of » ≈ 8 ; « Junior » plafonne à 1. */
export function titleLevel(title: string): { min: number | null; junior: boolean } {
  const t = new Set(tokenize(title));
  const junior = ["junior", "stage", "alternance"].some((x) => t.has(x));
  let min: number | null = null;
  const at = (n: number) => (min = Math.max(min ?? 0, n));
  if (t.has("confirme")) at(3);
  if (t.has("senior") || t.has("expert")) at(5);
  if (["techlead", "lead", "leader", "principal", "staff"].some((x) => t.has(x))) at(6);
  if (["head", "directeur", "vp", "chief", "cto", "cpo", "cfo"].some((x) => t.has(x))) at(8);
  return { min, junior };
}

export type SeniorityAssessment = {
  /** 0–100, pour l'affichage. */
  score: number;
  /** Multiplicateur appliqué à la note de base. */
  factor: number;
  required: number | null;
  profileYears: number | null;
  /** Motif d'exclusion, quand l'écart est rédhibitoire. */
  excluded: string | null;
  note: string | null;
};

export function assessSeniority(
  profileYears: number | null,
  title: string,
  description: string
): SeniorityAssessment {
  const level = titleLevel(title);
  const fromDesc = requiredYearsFromDescription(description);
  let required: number | null =
    fromDesc === null && level.min === null ? null : Math.max(fromDesc ?? 0, level.min ?? 0);
  if (level.junior) required = Math.min(required ?? 0, 1);

  const neutral = { score: 70, factor: 1, required, profileYears, excluded: null, note: null };
  if (profileYears === null || required === null) return neutral;

  const gap = required - profileYears;
  const years = (n: number) => `${n} an${n >= 2 ? "s" : ""}`;
  // Des années demandées nettement au-dessus du profil : l'offre recule, sans
  // être écartée. Un recruteur rabat souvent ses exigences, et l'ancien filtre
  // retirait des postes que la personne pouvait viser : sur l'ancien banc, six
  // « Business Analyst » jugés bons pour une junior (5 à 7 ans demandés) cédaient
  // la place à des offres hors sujet — NDCG@20 de 81 % à 88 % sans le filtre ;
  // banc marché (16 profils) inchangé. Une réduction plus forte au-delà de 5 ans
  // d'écart faisait moins bien (84-85 %).
  if (fromDesc !== null && fromDesc - profileYears >= 3) {
    const note = `expérience demandée : ${years(fromDesc)}, environ ${years(Math.round(profileYears))} au profil`;
    return { score: 20, factor: 0.55, required, profileYears, excluded: null, note };
  }
  // Titre seul : « Senior », « Lead » pour un profil qui a 3 ans de moins. Mesuré
  // sur un designer de 18 mois (octobre 2026) : à 0,7, les « Senior Product
  // Designer » restaient au niveau des postes à sa portée.
  if (gap >= 3) {
    return { score: 30, factor: 0.55, required, profileYears, excluded: null, note: "poste probablement trop senior (titre)" };
  }
  if (gap >= 1.5) return { score: 50, factor: 0.85, required, profileYears, excluded: null, note: `expérience demandée : ${years(required)}` };
  if (gap > 0) return { score: 80, factor: 0.95, required, profileYears, excluded: null, note: `expérience demandée : ${years(required)}` };
  if (level.junior && profileYears - required >= 6) {
    return { score: 60, factor: 0.85, required, profileYears, excluded: null, note: "poste junior pour un profil confirmé" };
  }
  return { score: 100, factor: 1, required, profileYears, excluded: null, note: required > 0 ? `expérience demandée : ${years(required)}, profil au niveau` : null };
}
