import "server-only";
import type { ScrapedOffre } from "@/lib/scrapers/base";
import { decodeHtmlEntities, repairDoubleEscapedHtml } from "@/lib/text/entities";
import { descriptionTextFromHtml, repairEscapedMarkupHtml, type EscapedMarkupRule } from "./escaped-markup";

/**
 * Filet de nettoyage des champs d'une offre, quelle que soit la source. Appliqué
 * une fois à chaque écriture (upsertOffreFromSource) et à l'offre que le scan note
 * (lib/scan/orchestrator.ts), pour que le score lise exactement le texte enregistré.
 * Les réparations des offres déjà en base (lib/db/repair-entities.ts,
 * lib/db/repair-markup.ts) suivent les mêmes règles.
 *
 * - Champs texte (titre, entreprise, pays, lieu, contrat, salaire, description_text) :
 *   entités décodées PUIS mojibake réparé (décoder d'abord répare aussi un mojibake
 *   écrit en entités, « caf&Atilde;&copy; »). Ces champs ne sont jamais rendus en HTML.
 *   Les scrapers décodent déjà ce qu'ils lisent brut (JSON Algolia, JSON-LD) : une entité
 *   qui reste ici vient d'une source échappée deux fois (« l&amp;apos; » chez LinkedIn).
 * - description_html : jamais décodé (c'est du HTML, « &lt;div&gt; » y est du texte) ;
 *   seul le double échappement « &amp;eacute; » est ramené à « &eacute; ».
 * - Balisage affiché en clair (lib/offres/escaped-markup.ts) : HTML échappé dans un
 *   nœud texte, fermante éclatée, balise coupée en fin de texte. Le HTML est réparé et le
 *   texte re-dérivé du HTML réparé, comme le scraper de la source l'aurait fait.
 */

// Filet de sécurité anti-mojibake : répare l'UTF-8 double-décodé (é→Ã©, ’→â€™…)
// quelle que soit la source. Signatures fiables uniquement — "Ã" suivi d'un
// caractère de continuation n'existe pas en français légitime.
const MOJIBAKE_RE = /Ã[©¨§ª«»¢€‚„¯´¹]|â€™|â€“|â€œ|â€|Ã‰|Ã€|Ã‡|Ã”|Ã‚|Â[«»°€œ]/;

export function fixMojibake(s: string): string;
export function fixMojibake(s: string | null): string | null;
export function fixMojibake(s: string | null): string | null {
  if (!s || !MOJIBAKE_RE.test(s)) return s;
  try {
    // Réparation par segments de caractères U+0000–U+00FF : un caractère au-delà
    // (« ’ », « € », émoji, souvent issu d'une entité décodée juste avant) n'est pas un
    // octet mal lu, et Buffer.from(…, "latin1") l'aurait tronqué (« l’Ã©quipe »
    // donnait « l\u0019équipe »). Sans tel caractère, résultat identique à avant.
    const repaired = s.replace(/[\u0000-ÿ]+/g, (run) => Buffer.from(run, "latin1").toString("utf8"));
    // On n'accepte la réparation que si elle n'introduit pas de caractère de
    // remplacement (perte) et qu'elle réduit bien les signatures mojibake.
    if (!repaired.includes("�") && !MOJIBAKE_RE.test(repaired)) return repaired;
  } catch {}
  return s;
}

/** Champ texte court : titre, entreprise, pays, lieu, type de contrat, salaire. */
export function cleanOffreText(s: string): string;
export function cleanOffreText(s: string | null): string | null;
export function cleanOffreText(s: string | null): string | null {
  return s == null ? s : fixMojibake(decodeHtmlEntities(s));
}

/** description_text : comme un champ court, l'espace insécable en entité devenant une espace (comme htmlToText). */
export function cleanOffreDescriptionText(s: string): string {
  return s == null ? s : fixMojibake(decodeHtmlEntities(s, { nbspToSpace: true }));
}

/** description_html : mojibake réparé, double échappement ramené à un niveau, jamais décodé. */
export function cleanOffreDescriptionHtml(s: string): string {
  return s == null ? s : repairDoubleEscapedHtml(fixMojibake(s));
}

export type EscapedMarkupDescription = {
  description_html: string;
  description_text: string;
  /** Règles appliquées au HTML (vide : rien à réparer). */
  rules: EscapedMarkupRule[];
  /** HTML réparé, mais texte gardé tel quel : il ne dérivait pas de ce HTML. */
  textKept: boolean;
};

const sameWords = (a: string, b: string) => a.replace(/\s+/g, " ").trim() === b.replace(/\s+/g, " ").trim();

/**
 * Balisage affiché en clair dans une description déjà nettoyée (filet d'écriture ou offre
 * en base) : HTML réparé (lib/offres/escaped-markup.ts) et description_text re-dérivé du
 * HTML réparé selon la source, puis nettoyé comme au scan. Le texte n'est re-dérivé que
 * s'il dérivait du HTML d'origine (blancs mis à part : un texte enregistré peut différer de
 * quelques espaces du texte dérivé) ; sinon il est gardé (textKept).
 * Rendu tel quel si le HTML n'a rien à réparer.
 */
export function repairEscapedMarkupDescription(source: string, html: string, text: string): EscapedMarkupDescription {
  const repaired = repairEscapedMarkupHtml(html);
  if (repaired.html === html) return { description_html: html, description_text: text, rules: [], textKept: false };
  const derived = sameWords(cleanOffreDescriptionText(descriptionTextFromHtml(source, html)), text);
  return {
    description_html: repaired.html,
    description_text: derived ? cleanOffreDescriptionText(descriptionTextFromHtml(source, repaired.html)) : text,
    rules: repaired.rules,
    textKept: !derived,
  };
}

/**
 * L'offre telle qu'elle sera enregistrée (et notée). À appliquer une seule fois par offre
 * scrapée. `source` : identifiant du scraper (apec, talent…), qui fixe la façon dont le
 * texte se re-dérive d'un HTML réparé.
 */
export function sanitizeScrapedOffre(o: ScrapedOffre, source: string): ScrapedOffre {
  const description = repairEscapedMarkupDescription(
    source,
    cleanOffreDescriptionHtml(o.description_html),
    cleanOffreDescriptionText(o.description_text)
  );
  return {
    ...o,
    title: cleanOffreText(o.title),
    company: cleanOffreText(o.company),
    country: cleanOffreText(o.country),
    location: cleanOffreText(o.location),
    contract_type: cleanOffreText(o.contract_type),
    salary: cleanOffreText(o.salary),
    description_html: description.description_html,
    description_text: description.description_text,
  };
}
