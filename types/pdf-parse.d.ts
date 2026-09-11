// pdf-parse ne fournit pas de types et son point d'entrée (index.js) lit un PDF de test
// au chargement. On importe donc le module interne `lib/pdf-parse.js`, qui n'a pas cet
// effet de bord — d'où cette déclaration locale plutôt que @types/pdf-parse (qui ne
// couvre que le chemin racine).
declare module "pdf-parse/lib/pdf-parse.js" {
  export interface PdfParseResult {
    /** Nombre de pages du document. */
    numpages: number;
    /** Nombre de pages effectivement rendues (voir l'option `max`). */
    numrender: number;
    /** Métadonnées d'information du PDF (Title, Author, Producer, ...). */
    info: Record<string, unknown>;
    /** Métadonnées XMP, `null` si absentes. */
    metadata: unknown;
    /** Version de pdf.js utilisée pour l'extraction. */
    version: string;
    /** Texte extrait, pages séparées par des sauts de ligne. */
    text: string;
  }

  export interface PdfParseOptions {
    /** Rendu personnalisé d'une page (par défaut : concaténation des items de texte). */
    pagerender?: (pageData: unknown) => string | Promise<string>;
    /** Nombre maximum de pages à analyser (0 = toutes). */
    max?: number;
    /** Version de pdf.js à charger. */
    version?: string;
  }

  export default function pdfParse(
    data: Buffer | Uint8Array,
    options?: PdfParseOptions
  ): Promise<PdfParseResult>;
}
