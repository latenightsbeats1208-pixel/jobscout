/**
 * Lecture du modèle pour l'éditeur : emplacements à remplir, textes anglais
 * manquants, aperçu d'un cluster. Aucune dépendance serveur.
 */
import type { DocLang } from "@/lib/text/lang";
import { findPlaceholders, selectBullets, type Selection } from "./select";
import type { CvTemplate, Loc } from "./types";

/** Un texte du modèle, repéré par son chemin JSON (« sections.0.entries.1.bullets.2.text.fr »). */
export type TemplateText = { path: string; where: string; lang: DocLang; text: string; placeholders: string[] };

/** Tous les textes bilingues du modèle, avec un libellé lisible. */
export function templateTexts(t: CvTemplate): TemplateText[] {
  const out: TemplateText[] = [];
  const add = (l: Loc | undefined, path: string, where: string) => {
    if (!l) return;
    for (const lang of ["fr", "en"] as const) {
      out.push({ path: `${path}.${lang}`, where, lang, text: l[lang] ?? "", placeholders: findPlaceholders(l[lang] ?? "") });
    }
  };
  t.identity.taglines.forEach((x, i) => add(x.text, `identity.taglines.${i}.text`, `Ligne d'identité ${x.countries.join(", ") || "par défaut"}`));
  t.clusters.forEach((c, i) => {
    add(c.headline, `clusters.${i}.headline`, `Titre par défaut ${c.id}`);
    add(c.profile, `clusters.${i}.profile`, `Profil ${c.id}`);
  });
  t.sections.forEach((s, si) => {
    add(s.title, `sections.${si}.title`, `Section ${s.id}`);
    s.entries.forEach((e, ei) => {
      const base = `sections.${si}.entries.${ei}`;
      add(e.heading, `${base}.heading`, `${e.id} — titre`);
      add(e.meta, `${base}.meta`, `${e.id} — dates`);
      add(e.sub, `${base}.sub`, `${e.id} — sous-titre`);
      e.bullets.forEach((b, bi) => add(b.text, `${base}.bullets.${bi}.text`, `Puce ${b.id}`));
    });
  });
  t.education.forEach((e, i) => {
    add(e.heading, `education.${i}.heading`, `Formation ${i + 1}`);
    add(e.meta, `education.${i}.meta`, `Formation ${i + 1} — dates`);
  });
  return out;
}

export function templatePlaceholders(t: CvTemplate): TemplateText[] {
  return templateTexts(t).filter((x) => x.placeholders.length > 0);
}

/** Textes sans version anglaise (le français sera utilisé dans un CV anglais). */
export function missingEnglish(t: CvTemplate): string[] {
  const fr = new Map(templateTexts(t).filter((x) => x.lang === "fr").map((x) => [x.path.slice(0, -3), x]));
  return templateTexts(t)
    .filter((x) => x.lang === "en" && !x.text && fr.get(x.path.slice(0, -3))?.text)
    .map((x) => x.where);
}

/** Écrit une valeur à un chemin JSON (copie). */
export function setAtPath<T>(obj: T, path: string, value: string): T {
  const copy = structuredClone(obj) as unknown as Record<string, unknown>;
  const keys = path.split(".");
  let cur: Record<string, unknown> = copy;
  for (const k of keys.slice(0, -1)) {
    const next = cur[k];
    if (next === null || typeof next !== "object") throw new Error(`chemin invalide : ${path}`);
    cur = next as Record<string, unknown>;
  }
  cur[keys[keys.length - 1]] = value;
  return copy as unknown as T;
}

/** Aperçu d'un cluster seul : son titre par défaut et ses puces, sans offre. */
export function clusterSelection(t: CvTemplate, clusterId: string, lang: DocLang): Selection {
  const cluster = t.clusters.find((c) => c.id === clusterId) ?? t.clusters[0];
  return {
    cluster: cluster.id,
    headline: lang === "en" && cluster.headline.en ? cluster.headline.en : cluster.headline.fr,
    bullets: selectBullets(t, cluster),
    extraSkills: [],
    mode: "auto",
  };
}
