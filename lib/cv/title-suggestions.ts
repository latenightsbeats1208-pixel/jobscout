import type { ProfileFull } from "./types";
import { normalize } from "@/lib/scoring/text";
import { profileExperienceYears, titleLevel } from "@/lib/scoring/seniority";

/**
 * Postes suggérés à partir du CV (lib/ai/suggest-titles.ts) : ce que le modèle
 * propose n'est gardé qu'après vérification, comme pour la relecture des offres.
 * - Chaque suggestion doit citer au moins un élément RÉEL du profil (intitulé
 *   d'expérience, formation, compétence, langue) : sans appui vérifié, elle
 *   tombe — c'est ce qui empêche un intitulé inventé.
 * - Un intitulé dont le niveau dépasse de 3 ans ou plus l'expérience du profil
 *   tombe aussi : c'est l'écart à partir duquel la note écarte une offre.
 * - Ni stage ni alternance, ni doublon d'un poste déjà visé.
 */

export type TitleFamily = "continuite" | "evolution" | "voisin";

export type TitleSuggestion = {
  title: string;
  family: TitleFamily;
  reason: string;
  /** Éléments du profil qui la justifient, tels qu'écrits dans le profil. */
  evidence: string[];
};

const FAMILIES = new Set<TitleFamily>(["continuite", "evolution", "voisin"]);
const MAX_SUGGESTIONS = 8;
const TRAINEE = /\b(stage|stagiaire|intern|internship|alternance|alternant|apprenti)/;

const key = (s: string) => normalize(s).replace(/\([hf]\s*\/\s*[hf]\)/g, " ").replace(/[^a-z0-9+#]+/g, " ").trim();

/** Ce qu'un appui peut citer : tout ce que le profil affirme, rien de déduit. */
function profileFacts(p: ProfileFull): { label: string; key: string }[] {
  const facts = [
    ...p.experiences.map((e) => e.title),
    ...p.educations.flatMap((e) => [e.degree, e.field, [e.degree, e.field].filter(Boolean).join(" ")]),
    ...p.skills.map((s) => s.name),
    ...p.experiences.flatMap((e) => e.skills_used),
    ...p.languages.map((l) => l.name),
  ];
  return facts.filter((f): f is string => !!f && key(f).length >= 2).map((label) => ({ label, key: key(label) }));
}

/** L'appui cité correspond-il à un élément du profil (à la casse, aux accents et à la ponctuation près) ? */
function matchFact(cited: string, facts: { label: string; key: string }[]): string | null {
  const k = key(cited);
  if (k.length < 2) return null;
  const hit = facts.find((f) => f.key === k) ?? facts.find((f) => (k.length >= 4 && f.key.includes(k)) || (f.key.length >= 4 && k.includes(f.key)));
  return hit?.label ?? null;
}

export function parseTitleSuggestions(raw: unknown, profile: ProfileFull, now = new Date()): TitleSuggestion[] {
  const list = (raw as { suggestions?: unknown } | null)?.suggestions;
  if (!Array.isArray(list)) return [];
  const facts = profileFacts(profile);
  const years = profileExperienceYears(profile, now) ?? 0;
  const taken = new Set((profile.target_titles ?? []).map(key));
  const out: TitleSuggestion[] = [];
  for (const item of list as Record<string, unknown>[]) {
    const title = typeof item?.intitule === "string" ? item.intitule.replace(/\s*\((?:h|f)\s*\/\s*(?:f|h)\)\s*/gi, " ").trim() : "";
    const family = item?.famille as TitleFamily;
    if (!title || !FAMILIES.has(family) || taken.has(key(title))) continue;
    if (TRAINEE.test(normalize(title))) continue;
    const { min } = titleLevel(title);
    if (min !== null && min - years >= 3) continue;
    const evidence = [
      ...new Set(
        (Array.isArray(item.appuis) ? item.appuis : [])
          .filter((a): a is string => typeof a === "string")
          .map((a) => matchFact(a, facts))
          .filter((a): a is string => !!a)
      ),
    ];
    if (!evidence.length) continue;
    taken.add(key(title));
    out.push({ title, family, reason: typeof item.raison === "string" ? item.raison.trim() : "", evidence });
    if (out.length >= MAX_SUGGESTIONS) break;
  }
  return out;
}

/** Sans IA : les intitulés des expériences, hors stage et alternance, du plus récent au plus ancien. */
export function localTitleSuggestions(profile: ProfileFull): TitleSuggestion[] {
  const taken = new Set((profile.target_titles ?? []).map(key));
  const out: TitleSuggestion[] = [];
  for (const e of profile.experiences) {
    if (!e.title || TRAINEE.test(normalize(e.title)) || taken.has(key(e.title))) continue;
    taken.add(key(e.title));
    out.push({ title: e.title, family: "continuite", reason: "Le poste que vous avez occupé.", evidence: [e.title] });
  }
  return out.slice(0, 3);
}
