import type { ProfileFull } from "@/lib/cv/types";
import { parseSearchArea, type SearchArea } from "@/lib/geo/fr";

/**
 * Ce qu'un scan cherche, déduit du profil. Partagé entre le serveur (le scan)
 * et l'interface (l'aperçu « Le prochain scan cherchera… » de la page Profil).
 *
 * Les requêtes sont les POSTES VISÉS. Avant, chaque source cherchait les cases
 * « secteur » (« tech », « services »…) : toutes les offres trouvées
 * contenaient ces mots, sans rapport avec le métier recherché. Les secteurs ne
 * servent plus de requête que lorsque le profil n'a ni poste visé ni
 * expérience ; ils restent des mots-clés pour la note.
 */

/** Au-delà, un scan s'allonge sans élargir beaucoup la recherche. */
export const MAX_QUERIES = 4;

const TRAINEE = /stag|intern|altern|apprenti|apprentice|trainee/i;

export type SearchPlan = {
  queries: string[];
  /** D'où viennent les requêtes, pour l'expliquer à l'utilisateur. */
  origin: "postes_vises" | "experiences" | "secteurs" | "aucune";
  /** Zone de recherche en France ; null = tout le pays. */
  area: SearchArea | null;
};

function unique(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values.map((x) => x.trim()).filter(Boolean)) {
    const key = v.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(v);
    }
  }
  return out;
}

export function buildSearchPlan(profile: Pick<ProfileFull, "target_titles" | "experiences" | "sectors" | "search_area">): SearchPlan {
  const area = parseSearchArea(profile.search_area);
  const titles = unique(profile.target_titles ?? []);
  if (titles.length) return { queries: titles.slice(0, MAX_QUERIES), origin: "postes_vises", area };
  // Sans poste visé : les intitulés des expériences récentes, hors stages et alternances.
  const past = unique(profile.experiences.map((e) => e.title).filter((t) => t && !TRAINEE.test(t))).slice(0, 2);
  if (past.length) return { queries: past, origin: "experiences", area };
  const sectors = unique(profile.sectors ?? []);
  if (sectors.length) return { queries: sectors.slice(0, MAX_QUERIES), origin: "secteurs", area };
  return { queries: [], origin: "aucune", area };
}

/**
 * Part de chaque requête dans le quota d'une source : sans elle, la première
 * requête remplissait tout le quota et les postes suivants n'étaient jamais
 * cherchés.
 */
export function quotaPerQuery(max: number, queryCount: number): number {
  return Math.max(1, Math.ceil(max / Math.max(1, queryCount)));
}
