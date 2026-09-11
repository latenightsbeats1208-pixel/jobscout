import "server-only";
import type { DocLang } from "@/lib/text/lang";

/**
 * Blocs de consigne « langue de sortie » injectés dans le message utilisateur
 * des générations (CV, lettre, message V.I.E). Le profil est en français ;
 * pour une offre en anglais, la seule mention « anglais si l'offre est en
 * anglais » du prompt système ne suffisait pas : le modèle traduisait
 * l'accroche et laissait le reste en français.
 */
export function cvLanguageInstruction(lang: DocLang): string {
  if (lang === "en") {
    return [
      "## LANGUE DE SORTIE : ANGLAIS — règle absolue",
      "L'offre est rédigée en anglais : le CV ENTIER doit être en anglais, comme s'il avait été écrit par un candidat anglophone pour un recruteur nord-américain. Le profil fourni est en français : TRADUIS TOUT —",
      "- `summary` ;",
      "- les intitulés de poste (« Chargé de Communication Digitale » → « Digital Communications Officer », « Chef de Projet » → « Project Manager », « Chargé de Développement de Comptes Clients » → « Account Development Manager ») ;",
      "- toutes les puces d'expériences, de projet et de formation ;",
      "- `degree` et `field` des formations (« Mastère Spécialisé » → « Advanced Master's degree (Mastère Spécialisé) », « Programme Grande École (Master 2) » → « Master's degree — Programme Grande École ») ;",
      "- `skills_flat` (« Gestion de projet » → « Project management », « Veille médiatique » → « Media monitoring ») ;",
      "- `languages[].name` (« Français » → « French », « Anglais » → « English », « Espagnol » → « Spanish ») et `languages[].level` (« Natif » → « Native », « Courant » → « Fluent » ; garde « C2 (TOEIC 925) ») ;",
      "- `projects[].role` (« Fondateur & Créateur de Contenu » → « Founder & Content Creator ») ;",
      "- dates en cours : `end_date` = « Present ».",
      "Ne conserve en français que les noms propres : entreprises, écoles, produits, noms de projet. Orthographe américaine cohérente, pas d'espace avant « : ». Puces au participe passé ou en style nominal (« Managed… », « Coordination of… »), jamais à la première personne, sans point final. AUCUN mot français ne doit subsister hors noms propres.",
    ].join("\n");
  }
  return "## Langue de sortie : FRANÇAIS\nL'offre n'est pas majoritairement en anglais : tout le CV est en français (les mots-clés anglais de l'offre peuvent être repris tels quels quand ils sont d'usage dans le métier).";
}

export function lmLanguageInstruction(lang: DocLang): string {
  if (lang === "en") {
    return [
      "## LANGUE DE SORTIE : ANGLAIS — règle absolue",
      "L'offre est rédigée en anglais : la lettre est ENTIÈREMENT en anglais (`object` et les 4 paragraphes), registre professionnel nord-américain, comme écrite par un candidat anglophone. `object` = « Application for the position of [intitulé exact, sans marque de genre du type (m/f/d)] » (+ « — Ref. [XXX] » si disponible), sans préfixe « Subject: » ni « Re: » : le template ajoute lui-même « Subject: ».",
      "Traduis les intitulés de poste et diplômes du profil ; garde les noms propres (entreprises, écoles, produits). Les règles ci-dessus s'appliquent telles quelles : phrases courtes, zéro invention, chiffres du profil, ce que le candidat apportera au futur (« I will bring… »). §4 OBLIGATOIRE si le lieu de l'offre diffère de la ville du candidat : une phrase explicite de mobilité qui NOMME la ville ou le pays de l'offre (modèle : « I am available for an on-site interview in [ville de l'offre] or by video call, and I am ready to relocate to [pays de l'offre] » — avec les vrais lieu et pays de l'offre, jamais d'autres). « abonnés » se traduit « followers » (TikTok, Instagram) ou « subscribers » (YouTube).",
      "Pas de salutation (« Dear… ») ni de formule finale (« Sincerely ») dans `body_paragraphs` : le template les ajoute. AUCUN mot français ne doit subsister hors noms propres.",
    ].join("\n");
  }
  return "## Langue de sortie : FRANÇAIS\nL'offre n'est pas majoritairement en anglais : la lettre est entièrement en français.";
}

export function msgLanguageInstruction(lang: DocLang): string {
  return lang === "en"
    ? "## LANGUE DE SORTIE : ANGLAIS — l'offre est rédigée en anglais : les 3 lignes du message sont entièrement en anglais (noms propres conservés)."
    : "## Langue de sortie : FRANÇAIS — l'offre n'est pas majoritairement en anglais : les 3 lignes du message sont en français.";
}
