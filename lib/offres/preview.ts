import { decodeHtmlEntities } from "@/lib/text/entities";

/**
 * Extrait de la description affiché dans l'aperçu de la liste des offres
 * (app/(app)/offres/list.tsx, composant client) : aucune dépendance serveur.
 *
 * Décodeur partagé : les textes en base sont décodés à l'écriture et par la réparation
 * unique (lib/db/repair-entities.ts), il ne sert plus que de garde-fou (l'ancien décodage local ignorait « &eacute; », « &rsquo; »… et
 * laissait passer les demi-codets). Espaces (insécables comprises) ramenées à une
 * seule, coupe à PREVIEW_EXCERPT_LENGTH sans couper un émoji en deux.
 */
export const PREVIEW_EXCERPT_LENGTH = 680;

export function previewExcerpt(text: string | null | undefined): string {
  const flat = decodeHtmlEntities(text ?? "").replace(/\s+/g, " ").trim();
  if (flat.length <= PREVIEW_EXCERPT_LENGTH) return flat;
  const cut = flat.slice(0, PREVIEW_EXCERPT_LENGTH);
  // Un demi-codet haut en dernière position : son second demi-codet a été coupé.
  return /[\uD800-\uDBFF]$/.test(cut) ? cut.slice(0, -1) : cut;
}
