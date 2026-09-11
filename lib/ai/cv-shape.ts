import { z } from "zod";
import { AiContentError } from "./errors";
import type { GeneratedCV } from "./generate-cv";
import { ONGOING_RE } from "@/lib/text/typography";

/**
 * Forme et tri du CV généré — partagés par la génération (lib/ai/generate-cv)
 * et le rendu (lib/pdf/render), qui appliquaient chacun leur copie du tri.
 */

/* ------------------------------------------------------------------ */
/* Validation d'exécution de la sortie d'outil                         */
/* ------------------------------------------------------------------ */

const nullableText = z.string().nullish().transform((v) => v ?? null);
const bullets = z.array(z.string()).nullish().transform((v) => v ?? []);

const experienceSchema = z.object({
  title: z.string(),
  company: nullableText,
  location: nullableText,
  start_date: nullableText,
  end_date: nullableText,
  bullet_points: bullets,
});

const educationSchema = z.object({
  school: z.string(),
  degree: nullableText,
  field: nullableText,
  start_date: nullableText,
  end_date: nullableText,
  bullet_points: bullets,
});

const projectSchema = z.object({
  name: z.string(),
  role: nullableText,
  start_date: nullableText,
  end_date: nullableText,
  bullet_points: bullets,
});

const generatedCVSchema = z.object({
  identity: z.object({
    full_name: z.string(),
    email: nullableText,
    phone: nullableText,
    location: nullableText,
    linkedin_url: nullableText,
    portfolio_url: nullableText,
  }),
  summary: z.string().nullish().transform((v) => v ?? ""),
  sections: z.object({
    experiences: z.array(experienceSchema),
    educations: z.array(educationSchema).nullish().transform((v) => v ?? []),
    skills_flat: z.array(z.string()).nullish().transform((v) => v ?? []),
    languages: z
      .array(z.object({ name: z.string(), level: nullableText }))
      .nullish()
      .transform((v) => v ?? []),
    projects: z.array(projectSchema).nullish().transform((v) => v ?? []),
  }),
});

/**
 * Valide la sortie d'outil AVANT de la faire circuler dans l'application.
 *
 * Le cast nu `t.input as GeneratedCV` faisait planter le validateur
 * anti-hallucination (`cv.sections.experiences.filter` sur `undefined`) quand
 * le modèle sérialisait `sections` en CHAÎNE au lieu d'un objet — reproduit 3
 * fois sur 3 avec claude-opus-4-8. Le proxy ayant déjà répondu 200, les points
 * étaient débités et l'utilisateur ne recevait qu'un message JS anglais.
 * Le schéma d'outil déclare bien `required`, mais l'API ne le garantit pas.
 */
export function parseGeneratedCV(input: unknown): GeneratedCV {
  // Récupération d'un cas observé : l'objet imbriqué renvoyé sous forme de JSON
  // sérialisé. On tente une fois de le relire, puis on valide normalement.
  let candidate = input;
  if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) {
    const sections = (candidate as { sections?: unknown }).sections;
    if (typeof sections === "string") {
      try {
        candidate = { ...(candidate as object), sections: JSON.parse(sections) };
      } catch {
        /* illisible : la validation ci-dessous produira le message FR */
      }
    }
  }

  const parsed = generatedCVSchema.safeParse(candidate);
  if (!parsed.success) {
    console.error("[generateCV] sortie d'outil hors schéma :", parsed.error.issues.slice(0, 5));
    throw new AiContentError(
      "La réponse IA pour le CV est inexploitable (structure inattendue) — relancez la génération."
    );
  }
  if (parsed.data.sections.experiences.length === 0) {
    throw new AiContentError(
      "La réponse IA pour le CV ne contient aucune expérience — relancez la génération."
    );
  }
  return parsed.data;
}

/* ------------------------------------------------------------------ */
/* Tri anti-chronologique                                              */
/* ------------------------------------------------------------------ */

const ISO_MONTH = /^(\d{4})-(\d{1,2})/; // 2024-03, 2024-03-01
const MONTH_YEAR = /^(\d{1,2})\/(\d{4})$/; // 03/2024 — format imposé par prompts/generate-cv.md
const YEAR_ONLY = /^(\d{4})$/;

/**
 * Clé triable `YYYY-MM` pour une date de CV, quel que soit le format rendu par
 * le modèle. Indispensable : le prompt impose `MM/AAAA` (et « Aujourd'hui »
 * pour un poste en cours), or l'ancien tri comparait ces chaînes brutes —
 * `"08/2023".localeCompare("06/2024")` vaut 1, donc 2023 passait APRÈS 2024 et
 * les expériences sortaient dans le désordre. Pire, `enforceAtsLimits` ne garde
 * que les 4 premières : un tri faux pouvait supprimer la plus récente.
 */
export function dateSortKey(raw: string | null | undefined): string {
  const v = (raw ?? "").trim();
  if (!v) return "0000-00";
  if (ONGOING_RE.test(v)) return "9999-12";
  const iso = ISO_MONTH.exec(v);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, "0")}`;
  const fr = MONTH_YEAR.exec(v);
  if (fr) return `${fr[2]}-${fr[1].padStart(2, "0")}`;
  const year = YEAR_ONLY.exec(v);
  if (year) return `${year[1]}-12`;
  return "0000-00";
}

type DatedEntry = { start_date: string | null; end_date: string | null };

/** Date de référence d'une expérience : sa fin, à défaut son début. */
function endKey(e: DatedEntry): string {
  const end = dateSortKey(e.end_date);
  return end === "0000-00" ? dateSortKey(e.start_date) : end;
}

/** Comparateur « plus récent d'abord », à passer tel quel à Array.sort. */
export function compareRecentFirst(a: DatedEntry, b: DatedEntry): number {
  const byEnd = endKey(b).localeCompare(endKey(a));
  if (byEnd !== 0) return byEnd;
  return dateSortKey(b.start_date).localeCompare(dateSortKey(a.start_date));
}
