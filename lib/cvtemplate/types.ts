import { z } from "zod";

/**
 * Modèle de CV « maître » : le CV n'est plus rédigé par l'IA, il est ASSEMBLÉ
 * à partir de textes écrits une fois pour toutes par l'utilisateur.
 *
 * - Un cluster (A, B, C…) = une famille de postes : il fixe le titre par
 *   défaut, le paragraphe de profil, l'ordre des sections et le bloc de
 *   compétences.
 * - Chaque puce de la banque porte les clusters qu'elle sert. Plusieurs
 *   versions d'un même fait partagent un `group` : une seule par CV.
 * - Adapter le CV à une offre = choisir un cluster et des identifiants de
 *   puces ; aucun texte n'est inventé ni reformulé.
 */

const Text = z.string().trim();

/** Texte bilingue. L'anglais peut manquer : le français sert alors de repli (avec avertissement). */
export const LocSchema = z.object({ fr: Text.min(1), en: Text.optional().default("") });
export type Loc = z.infer<typeof LocSchema>;

const Id = z
  .string()
  .trim()
  .min(1)
  .max(40)
  .regex(/^[A-Za-z0-9_-]+$/, "identifiant : lettres, chiffres, « - » ou « _ » uniquement");

export const BulletSchema = z.object({
  id: Id,
  /** Les versions d'un même fait partagent ce groupe (une seule par CV). Défaut : l'id avant le premier « - ». */
  group: z.string().trim().min(1).optional(),
  /** Clusters servis ; « * » = tous. */
  clusters: z.array(z.string().trim().min(1)).min(1),
  text: LocSchema,
  /** Groupes que cette puce résume (ex. une ligne « Autres projets ») : exclue si l'un d'eux est déjà retenu. */
  covers: z.array(z.string().trim().min(1)).optional().default([]),
});
export type Bullet = z.infer<typeof BulletSchema>;

export const EntrySchema = z.object({
  id: Id,
  /** Ligne de titre ; absente pour une simple liste de puces (ex. « Fondations »). */
  heading: LocSchema.optional(),
  /** Fin de la ligne de titre : dates, technologies (« juil. 2026 – présent »). */
  meta: LocSchema.optional(),
  /** Ligne en italique sous le titre (équipe, lieu). */
  sub: LocSchema.optional(),
  bullets: z.array(BulletSchema).default([]),
  /** Nombre de puces visé ; complété avec des puces hors cluster si besoin. */
  min_bullets: z.number().int().min(0).max(10).default(0),
  max_bullets: z.number().int().min(0).max(10).default(3),
  /** Faux : l'entrée n'apparaît que si au moins une de ses puces sert le cluster. */
  always: z.boolean().default(true),
});
export type Entry = z.infer<typeof EntrySchema>;

export const SectionSchema = z.object({
  id: Id,
  title: LocSchema,
  entries: z.array(EntrySchema).min(1),
});
export type Section = z.infer<typeof SectionSchema>;

export const SkillLineSchema = z.object({ label: Text.min(1), items: Text.min(1) });
export type SkillLine = z.infer<typeof SkillLineSchema>;

export const ClusterSchema = z.object({
  id: Id,
  name: Text.min(1),
  /** Intitulés de postes couverts (aide au choix du cluster, IA comme mots-clés). */
  titles: Text.default(""),
  /** Mots-clés de repli (sans IA) : leur présence dans l'offre désigne ce cluster. */
  keywords: z.array(Text.min(1)).default([]),
  headline: LocSchema,
  profile: LocSchema,
  /** Ordre des sections du milieu (ids de `sections`) ; une section absente n'est pas rendue. */
  order: z.array(Id).min(1),
  /** Puces à placer en tête (ids), dans cet ordre ; le reste suit l'ordre du modèle. */
  priority: z.array(Id).default([]),
  /** Nombre maximal de puces par entrée, propre au cluster (ex. 3 puces NBA pour C). */
  limits: z.record(z.string(), z.number().int().min(0).max(10)).default({}),
  skills: z.object({ fr: z.array(SkillLineSchema).min(1), en: z.array(SkillLineSchema).default([]) }),
});
export type Cluster = z.infer<typeof ClusterSchema>;

export const TaglineSchema = z.object({
  /** Codes pays ISO (CH, FR…) où cette ligne s'applique ; vide = ligne par défaut. */
  countries: z.array(z.string().trim().length(2)).default([]),
  text: LocSchema,
});

export const CvTemplateSchema = z.object({
  version: z.literal(1).default(1),
  identity: z.object({
    full_name: Text.min(1),
    /** Éléments de la ligne de contact, séparés par « · » au rendu. */
    contact: z.array(Text.min(1)).min(1),
    /** Ligne sous le contact (nationalité, permis, disponibilité, langues), selon le pays de l'offre. */
    taglines: z.array(TaglineSchema).default([]),
  }),
  labels: z
    .object({
      profile: LocSchema.default({ fr: "Profil", en: "Profile" }),
      education: LocSchema.default({ fr: "Formation", en: "Education" }),
      skills: LocSchema.default({ fr: "Compétences", en: "Skills" }),
      extra_skills: LocSchema.default({ fr: "Autres", en: "Other" }),
    })
    .default({}),
  clusters: z.array(ClusterSchema).min(1),
  sections: z.array(SectionSchema).min(1),
  education: z.array(z.object({ heading: LocSchema, meta: LocSchema.optional() })).default([]),
  /** Mots-clés que vous savez défendre en entretien, hors blocs de compétences : ajoutables s'ils figurent dans l'offre. */
  extra_keywords: z.array(Text.min(1)).default([]),
  /** Consignes libres transmises à l'IA lors du choix (facultatif). */
  instructions: Text.default(""),
});
export type CvTemplate = z.infer<typeof CvTemplateSchema>;

/** Groupe effectif d'une puce. */
export function bulletGroup(b: Bullet): string {
  return b.group ?? b.id.split("-")[0];
}

/** Valide un modèle et vérifie sa cohérence interne (ids uniques, références existantes). */
export function parseCvTemplate(raw: unknown): { ok: true; template: CvTemplate } | { ok: false; errors: string[] } {
  const parsed = CvTemplateSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.slice(0, 20).map((i) => `${i.path.join(".") || "(racine)"} : ${i.message}`),
    };
  }
  const t = parsed.data;
  const errors: string[] = [];
  const sectionIds = new Set<string>();
  const entryIds = new Set<string>();
  const bulletIds = new Set<string>();
  const clusterIds = new Set(t.clusters.map((c) => c.id));
  if (clusterIds.size !== t.clusters.length) errors.push("clusters : identifiants en double");
  for (const s of t.sections) {
    if (sectionIds.has(s.id)) errors.push(`sections : « ${s.id} » en double`);
    sectionIds.add(s.id);
    for (const e of s.entries) {
      if (entryIds.has(e.id)) errors.push(`entrée « ${e.id} » en double`);
      entryIds.add(e.id);
      if (e.min_bullets > e.max_bullets) errors.push(`entrée « ${e.id} » : min_bullets > max_bullets`);
      for (const b of e.bullets) {
        if (bulletIds.has(b.id)) errors.push(`puce « ${b.id} » en double`);
        bulletIds.add(b.id);
        for (const c of b.clusters) {
          if (c !== "*" && !clusterIds.has(c)) errors.push(`puce « ${b.id} » : cluster « ${c} » inconnu`);
        }
      }
    }
  }
  for (const c of t.clusters) {
    for (const s of c.order) if (!sectionIds.has(s)) errors.push(`cluster ${c.id} : section « ${s} » inconnue`);
    for (const p of c.priority) if (!bulletIds.has(p)) errors.push(`cluster ${c.id} : puce prioritaire « ${p} » inconnue`);
    for (const e of Object.keys(c.limits)) if (!entryIds.has(e)) errors.push(`cluster ${c.id} : entrée « ${e} » inconnue dans limits`);
  }
  return errors.length ? { ok: false, errors } : { ok: true, template: t };
}
