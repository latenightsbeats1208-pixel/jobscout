// Métadonnées des sources — importable côté client ET serveur (pas de "server-only").
// La liste des scrapers effectifs vit dans lib/scrapers/registry.ts (server-only) ;
// les deux doivent rester synchronisées via SOURCE_IDS.

export type SourceMeta = {
  id: string;
  label: string;
  sublabel: string;
  // Périmètre géographique : "world" = international, "fr" = France uniquement
  scope: "world" | "fr";
  /**
   * La source a besoin du moteur de navigation Chromium (~100 Mo à télécharger,
   * ~265 Mo sur le disque), téléchargé
   * à la demande et non embarqué dans l'installeur. Décochée par défaut.
   */
  requiresEngine?: boolean;
};

export const SOURCES_META: SourceMeta[] = [
  { id: "wttj", label: "Welcome to the Jungle", sublabel: "Startups & scale-ups", scope: "world" },
  {
    id: "linkedin",
    label: "LinkedIn",
    sublabel: "Nécessite le moteur Chromium (~100 Mo)",
    scope: "world",
    requiresEngine: true,
  },
  { id: "civiweb", label: "Civiweb — V.I.E", sublabel: "Business France (international)", scope: "world" },
  { id: "apec", label: "APEC", sublabel: "Offres cadres (France)", scope: "fr" },
  { id: "hellowork", label: "HelloWork", sublabel: "Ex-RegionsJob (France)", scope: "fr" },
  { id: "francetravail", label: "France Travail", sublabel: "Ex-Pôle Emploi (France)", scope: "fr" },
  { id: "talent", label: "Talent.com", sublabel: "Francophonie · Canada · USA", scope: "world" },
];

export const SOURCE_IDS = SOURCES_META.map((s) => s.id);

/**
 * Sources cochées par défaut : toutes sauf celles qui exigent un téléchargement
 * supplémentaire. Une installation neuve ne télécharge donc rien de plus.
 */
export const DEFAULT_SOURCE_IDS = SOURCES_META.filter((s) => !s.requiresEngine).map(
  (s) => s.id
);

export function sourceRequiresEngine(id: string): boolean {
  return SOURCES_META.some((s) => s.id === id && s.requiresEngine === true);
}

export function sourceLabel(id: string): string {
  return SOURCES_META.find((s) => s.id === id)?.label ?? id;
}
