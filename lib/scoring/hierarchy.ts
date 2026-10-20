import { normalize } from "./text";

/**
 * Rang hiérarchique d'un intitulé, de 1 (assistant, junior) à 5 (direction).
 * Les années demandées (seniority.ts) ne disent pas tout : un directeur supply
 * chain qui encadre 240 personnes voyait des postes de chef d'équipe
 * logistique, une jeune diplômée des postes de « Head of Performance » ou de
 * « Responsable marketing digital » (audit d'octobre 2026).
 */
export type Rank = 1 | 2 | 3 | 4 | 5;

const DIRECTION = /\b(directeur|directrice|director|head|vp|vice president|chief|cto|cfo|coo|cmo|cio|ceo|pdg)\b/;
const MANAGEMENT = /\b(responsable|manager|chef de service|chef de departement|chef d agence|chef de cuisine)\b/;
/**
 * « Manager » sans encadrement : un chef de produit, un chargé de comptes ou
 * de campagnes. Ce sont des postes de spécialiste, pas de responsable d'équipe.
 */
const SPECIALIST_MANAGER =
  /\b(account|accounts|community|office|product|traffic|performance|content|social media|brand|category|crm|seo|sea|ads|media|campaign|customer success|success|partner|partnership|case|delivery|release|scrum|change|engagement)\s+manager\b/;
const LEAD = /\b(chef de projet|chef de projets|project manager|chef d equipe|chef de groupe|team lead|tech lead|lead|leader|superviseur|supervisor|coordinateur|coordinatrice|coordinator|encadrant)\b/;
const JUNIOR = /\b(assistant|assistante|junior|stagiaire|stage|apprenti|apprentie|alternant|alternante|alternance|intern|trainee)\b/;

export function titleRank(title: string): Rank {
  const t = normalize(title).replace(/[^a-z0-9]+/g, " ");
  if (DIRECTION.test(t)) return 5;
  if (MANAGEMENT.test(t) && !SPECIALIST_MANAGER.test(t)) return 4;
  if (LEAD.test(t)) return 3;
  if (JUNIOR.test(t)) return 1;
  return 2;
}

/** Rangs des postes visés : le plus bas et le plus haut. null sans poste visé. */
export function profileRanks(targetTitles: string[]): { min: Rank; max: Rank } | null {
  const ranks = targetTitles.filter((t) => t.trim()).map(titleRank);
  if (!ranks.length) return null;
  return { min: Math.min(...ranks) as Rank, max: Math.max(...ranks) as Rank };
}

export type HierarchyAssessment = { factor: number; note: string | null };

/** Encadrement que l'offre demande, contre celui que la personne vise. */
export function assessHierarchy(
  ranks: { min: Rank; max: Rank } | null,
  profileYears: number | null,
  offerTitle: string
): HierarchyAssessment {
  if (!ranks) return { factor: 1, note: null };
  const rank = titleRank(offerTitle);
  // Au-dessous : seulement pour qui ne vise QUE des postes d'encadrement. Une
  // conductrice de travaux qui vise aussi « Responsable travaux » garde les
  // postes de conducteur.
  if (ranks.min >= 4 && rank <= ranks.min - 2) return { factor: 0.6, note: "poste nettement en dessous de votre niveau" };
  if (ranks.min === 5 && rank === 4) return { factor: 0.85, note: "poste un cran en dessous de votre niveau" };
  // Au-dessus : un poste d'encadrement pour qui ne l'a jamais exercé. Au-delà de
  // six ans d'expérience, l'évolution est plausible et la note n'y touche pas.
  const years = profileYears ?? 0;
  if (rank >= 4 && rank >= ranks.max + 2 && years < 6) return { factor: 0.6, note: "poste d'encadrement au-dessus de votre expérience" };
  if (rank >= 4 && rank === ranks.max + 1 && years < 3) return { factor: 0.85, note: "poste d'encadrement pour un premier emploi" };
  return { factor: 1, note: null };
}
