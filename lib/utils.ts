import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * Tailles de texte propres au projet (clés de `theme.extend.fontSize` dans
 * tailwind.config.ts ; tests/utils-cn.test.ts vérifie que les deux listes
 * restent identiques). Sans cette déclaration, tailwind-merge prend
 * `text-small` pour une COULEUR : `cn("text-small", "text-white")` perdait la
 * taille, `cn("text-caption", variantes)` perdait la couleur ou la taille
 * (badges affichés en 16 px, texte des boutons principaux retombé à 3,6:1).
 */
export const FONT_SIZE_TOKENS = ["display", "h1", "h2", "h3", "body", "small", "caption"] as const;

/** Ombres propres au projet (`theme.extend.boxShadow`), sinon lues comme des couleurs d'ombre. */
export const SHADOW_TOKENS = ["card", "elevated"] as const;

const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [{ text: [...FONT_SIZE_TOKENS] }],
      shadow: [{ shadow: [...SHADOW_TOKENS] }],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Date SQLite (« 2026-10-11 14:09:57 », UTC sans fuseau) → ISO lisible par Date. */
export function fromSqliteUtc(value: string): string {
  return /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value) ? `${value.replace(" ", "T")}Z` : value;
}

export function formatRelativeDate(iso: string): string {
  const date = new Date(iso);
  const diff = Date.now() - date.getTime();
  const min = 60_000, hour = 60 * min, day = 24 * hour;
  if (diff < hour) return `il y a ${Math.max(1, Math.floor(diff / min))} min`;
  if (diff < day) return `il y a ${Math.floor(diff / hour)}h`;
  if (diff < 7 * day) return `il y a ${Math.floor(diff / day)} j`;
  return date.toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" });
}

export type ScoreTone = "excellent" | "bon" | "moyen" | "faible";

const TONE_COLORS: Record<ScoreTone, { bg: string; fg: string }> = {
  excellent: { bg: "rgb(var(--success-rgb) / .12)", fg: "var(--success-ink)" },
  bon: { bg: "rgb(var(--accent-rgb) / .12)", fg: "var(--accent-ink)" },
  moyen: { bg: "rgb(var(--warning-rgb) / .12)", fg: "var(--warning-ink)" },
  faible: { bg: "rgb(var(--neutral-rgb) / .12)", fg: "var(--neutral-ink)" },
};

/**
 * Code couleur du score sur une échelle fixe. `fg`/`bg` sont des variables CSS
 * (globals.css) : elles suivent le thème clair/sombre et restent ≥ 4,5:1 (texte
 * `fg` sur fond `bg`). `tone` se pose tel quel sur une pastille :
 * `<span className="score-badge" data-tone={tone}>`. Pour une offre, préférer
 * scoreDisplay : la même note ne veut pas dire la même chose d'un profil à l'autre.
 */
export function scoreColor(score: number): { bg: string; fg: string; label: string; tone: ScoreTone } {
  if (score >= 80) return { ...TONE_COLORS.excellent, label: "Excellent", tone: "excellent" };
  if (score >= 60) return { ...TONE_COLORS.bon, label: "Bon", tone: "bon" };
  if (score >= 40) return { ...TONE_COLORS.moyen, label: "Moyen", tone: "moyen" };
  return { ...TONE_COLORS.faible, label: "Faible", tone: "faible" };
}

/** Couleurs d'un ton de note déjà calculé (voir scoreDisplay). */
export function scoreTone(tone: ScoreTone): { bg: string; fg: string } {
  return TONE_COLORS[tone];
}

/** Notes qui ouvrent les 10 %, 30 % et 60 % les mieux notés de la liste de l'utilisateur. */
export type ScoreScale = { best: number; high: number; middle: number };

/** Échelle relative ; null sous 10 offres, où un rang ne dit rien. */
export function scoreScale(scores: number[]): ScoreScale | null {
  if (scores.length < 10) return null;
  const sorted = [...scores].sort((a, b) => b - a);
  const at = (share: number) => sorted[Math.min(sorted.length - 1, Math.ceil(share * sorted.length) - 1)];
  return { best: at(0.1), high: at(0.3), middle: at(0.6) };
}

const VERDICT_DISPLAY: Record<string, { tone: ScoreTone; label: string }> = {
  postuler: { tone: "excellent", label: "Relue par l'IA : à postuler" },
  a_tenter: { tone: "moyen", label: "Relue par l'IA : à tenter" },
  hors_profil: { tone: "faible", label: "Relue par l'IA : hors profil" },
};

/**
 * Ce que la note veut dire pour cette personne. Les libellés fixes
 * (« Excellent » dès 80, « Bon » dès 60) trompaient d'un profil à l'autre :
 * l'offre parfaite d'une jeune diplômée valait 51 (« Moyen »), un hors-sujet
 * proposé à un enseignant 76 (« Bon »), un poste inaccessible 83 (« Excellent »)
 * — audit d'octobre 2026. Le verdict de l'IA l'emporte quand il existe ; sinon
 * le rang de l'offre dans la liste de la personne.
 */
export function scoreDisplay(
  score: number,
  opts: { scale: ScoreScale | null; verdict?: string | null; excluded?: boolean; outOfZone?: boolean }
): { bg: string; fg: string; label: string; tone: ScoreTone } {
  const pick = (tone: ScoreTone, label: string) => ({ ...TONE_COLORS[tone], tone, label });
  if (opts.excluded) return pick("faible", "Hors de vos critères");
  // L'IA juge le poste, pas la distance : elle disait « postuler » pour un poste
  // sur site à Nice proposé à un développeur de Brest (audit d'octobre 2026).
  if (opts.verdict === "postuler" && opts.outOfZone) return pick("bon", "Relue par l'IA : à postuler, mais hors de votre zone");
  const verdict = opts.verdict ? VERDICT_DISPLAY[opts.verdict] : undefined;
  if (verdict) return pick(verdict.tone, verdict.label);
  const { scale } = opts;
  if (!scale) return scoreColor(score);
  if (score >= scale.best) return pick("excellent", "Parmi vos meilleures offres");
  if (score >= scale.high) return pick("bon", "Haut de votre liste");
  if (score >= scale.middle) return pick("moyen", "Milieu de votre liste");
  return pick("faible", "Bas de votre liste");
}
