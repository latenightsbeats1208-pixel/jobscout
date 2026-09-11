/**
 * Strict V.I.E (Volontariat International en Entreprise) detection.
 *
 * Why strict ? Le simple mot "vie" en français ("vie professionnelle", "qualité de vie")
 * matche n'importe quoi. Cette détection ne classe une offre comme V.I.E que si
 * un marqueur clair existe.
 *
 *  - Civiweb (mon-vie-via.businessfrance.fr) → toujours V.I.E
 *  - Sinon : présence d'un des marqueurs suivants
 *      * "V.I.E" avec points (ex. "Offre V.I.E", "contrat V.I.E")
 *      * "Volontariat International en Entreprise" (ou "Volontariat International")
 *      * "Business France" + contexte international
 *      * "VIE" en majuscules entouré d'un mot-clé contractuel (programme, contrat, offer…)
 *      * "International Volunteer Program/Programme/Experience" (anglais)
 */

const MARKER_DOTTED_VIE = /\bV\s*\.\s*I\s*\.\s*E\b/i;
const MARKER_VOLONTARIAT = /\bvolontariat\s+international(?:\s+en\s+entreprise)?\b/i;
const MARKER_BUSINESS_FRANCE = /\bbusiness\s+france\b/i;
const MARKER_INTERNATIONAL_VOLUNTEER = /\binternational\s+volunteer\s+(?:program(?:me)?|experience|opportunity)\b/i;

// "VIE" en majuscules isolé (pas "vie" minuscule qui veut juste dire "life")
const VIE_ACRONYM_STANDALONE = /(?:^|[\s(\-\/.,;:])VIE(?=[\s)\-\/.,;:!?]|$)/;

// Contextes qui confirment un VIE quand on rencontre l'acronyme isolé
const VIE_CONTEXT = /(?:programme|contrat|offre|opportunit|position|poste|opportunity|business\s*france|volontariat|international|18\s*mois|24\s*mois|à\s+l'?[ée]tranger|abroad)/i;

export function detectVie(opts: {
  source: string;
  title?: string | null;
  description?: string | null;
  url?: string | null;
}): boolean {
  // Civiweb is V.I.E by definition
  if (opts.source === "civiweb") return true;

  // Civiweb URLs sometimes appear on other sources via redirect
  if (opts.url && /(?:mon-vie-via|civiweb|businessfrance)/i.test(opts.url)) return true;

  const text = `${opts.title ?? ""} ${(opts.description ?? "").slice(0, 4000)}`;

  if (MARKER_DOTTED_VIE.test(text)) return true;
  if (MARKER_VOLONTARIAT.test(text)) return true;
  if (MARKER_INTERNATIONAL_VOLUNTEER.test(text)) return true;

  // Business France alone isn't enough (it's also a tech/biz school) — combine with other context
  if (MARKER_BUSINESS_FRANCE.test(text) && VIE_CONTEXT.test(text)) return true;

  // "VIE" acronym in caps requires a contextual confirmation in nearby text
  if (VIE_ACRONYM_STANDALONE.test(text)) {
    // Search around the acronym occurrence for a context word (within ~120 chars)
    const idx = text.search(VIE_ACRONYM_STANDALONE);
    if (idx !== -1) {
      const window = text.slice(Math.max(0, idx - 120), Math.min(text.length, idx + 120));
      if (VIE_CONTEXT.test(window)) return true;
    }
  }

  return false;
}
