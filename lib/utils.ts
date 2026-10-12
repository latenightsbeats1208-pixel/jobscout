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

/**
 * Code couleur du score. `fg`/`bg` sont des variables CSS (globals.css) : elles
 * suivent le thème clair/sombre et restent ≥ 4,5:1 (texte `fg` sur fond `bg`).
 * `tone` se pose tel quel sur une pastille : `<span className="score-badge" data-tone={tone}>`.
 */
export function scoreColor(score: number): { bg: string; fg: string; label: string; tone: ScoreTone } {
  if (score >= 80) return { bg: "rgb(var(--success-rgb) / .12)", fg: "var(--success-ink)", label: "Excellent", tone: "excellent" };
  if (score >= 60) return { bg: "rgb(var(--accent-rgb) / .12)", fg: "var(--accent-ink)", label: "Bon", tone: "bon" };
  if (score >= 40) return { bg: "rgb(var(--warning-rgb) / .12)", fg: "var(--warning-ink)", label: "Moyen", tone: "moyen" };
  return { bg: "rgb(var(--neutral-rgb) / .12)", fg: "var(--neutral-ink)", label: "Faible", tone: "faible" };
}
