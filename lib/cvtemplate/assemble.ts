/**
 * Selection + modèle → document prêt à rendre (PDF et DOCX lisent le même).
 * Aucune dépendance serveur.
 */
import { typographyFor } from "@/lib/text/typography";
import { nameToCode, strictCountryName } from "@/lib/countries";
import type { DocLang } from "@/lib/text/lang";
import { findPlaceholders, type OffreLike, type Selection } from "./select";
import type { CvTemplate, Loc, SkillLine } from "./types";

export type TemplateCvEntry = { id: string; heading: string; meta: string | null; sub: string | null; bullets: { id: string; text: string }[] };
export type TemplateCvSection = { id: string; title: string; entries: TemplateCvEntry[] };

export type TemplateCvDoc = {
  lang: DocLang;
  name: string;
  headline: string;
  contact: string[];
  tagline: string | null;
  profileTitle: string;
  profile: string;
  sections: TemplateCvSection[];
  educationTitle: string;
  education: { heading: string; meta: string | null }[];
  skillsTitle: string;
  skills: SkillLine[];
  cluster: { id: string; name: string };
  mode: Selection["mode"];
  /** Emplacements non remplis, textes anglais manquants, puces retirées pour tenir sur une page. */
  warnings: string[];
};

export function assembleTemplateCv(t: CvTemplate, sel: Selection, offre: OffreLike, lang: DocLang): TemplateCvDoc {
  const cluster = t.clusters.find((c) => c.id === sel.cluster) ?? t.clusters[0];
  const ty = typographyFor(lang);
  const missingEn: string[] = [];
  const loc = (l: Loc | undefined, ref: string): string | null => {
    if (!l) return null;
    if (lang === "en") {
      if (l.en) return ty(l.en);
      missingEn.push(ref);
    }
    return ty(l.fr);
  };

  const sections: TemplateCvSection[] = [];
  for (const sectionId of cluster.order) {
    const section = t.sections.find((s) => s.id === sectionId);
    if (!section) continue;
    const entries: TemplateCvEntry[] = [];
    for (const entry of section.entries) {
      const ids = sel.bullets[entry.id];
      if (!ids) continue;
      const byId = new Map(entry.bullets.map((b) => [b.id, b]));
      entries.push({
        id: entry.id,
        heading: loc(entry.heading, entry.id) ?? "", // vide : liste de puces sans titre
        meta: loc(entry.meta, `${entry.id} (dates)`),
        sub: loc(entry.sub, `${entry.id} (sous-titre)`),
        bullets: ids.flatMap((id) => {
          const b = byId.get(id);
          return b ? [{ id, text: loc(b.text, id) ?? "" }] : [];
        }),
      });
    }
    if (entries.length) sections.push({ id: section.id, title: loc(section.title, section.id) ?? section.id, entries });
  }

  // Pays de l'offre en code ISO : les sources l'écrivent en toutes lettres (« Suisse », « Switzerland »).
  const country = nameToCode(strictCountryName(offre.country)) ?? "";
  const tagline =
    t.identity.taglines.find((x) => country && x.countries.map((c) => c.toUpperCase()).includes(country)) ??
    t.identity.taglines.find((x) => x.countries.length === 0);

  const skillsSource = lang === "en" && cluster.skills.en.length ? cluster.skills.en : cluster.skills.fr;
  if (lang === "en" && !cluster.skills.en.length) missingEn.push(`compétences ${cluster.id}`);
  const skills = skillsSource.map((s) => ({ label: ty(s.label), items: ty(s.items) }));
  if (sel.extraSkills.length) {
    skills.push({ label: loc(t.labels.extra_skills, "libellé") ?? "", items: ty(sel.extraSkills.join(", ")) });
  }

  const doc: TemplateCvDoc = {
    lang,
    name: t.identity.full_name,
    headline: ty(sel.headline),
    contact: t.identity.contact,
    tagline: tagline ? loc(tagline.text, "ligne d'identité") : null,
    profileTitle: loc(t.labels.profile, "libellé") ?? "",
    profile: loc(cluster.profile, `profil ${cluster.id}`) ?? "",
    sections,
    educationTitle: loc(t.labels.education, "libellé") ?? "",
    education: t.education.map((e, i) => ({ heading: loc(e.heading, `formation ${i + 1}`) ?? "", meta: loc(e.meta, `formation ${i + 1}`) })),
    skillsTitle: loc(t.labels.skills, "libellé") ?? "",
    skills,
    cluster: { id: cluster.id, name: cluster.name },
    mode: sel.mode,
    warnings: [],
  };
  doc.warnings = documentWarnings(doc);
  if (missingEn.length) {
    doc.warnings.push(`Texte anglais manquant (français utilisé) : ${[...new Set(missingEn)].join(", ")}.`);
  }
  return doc;
}

/** Emplacements « [N] », « [mois] » restés dans le document : à remplir avant envoi. */
export function documentWarnings(doc: TemplateCvDoc): string[] {
  const found = new Map<string, Set<string>>();
  const note = (where: string, text: string | null) => {
    for (const p of findPlaceholders(text ?? "")) {
      if (!found.has(p)) found.set(p, new Set());
      found.get(p)!.add(where);
    }
  };
  note("titre", doc.headline);
  note("profil", doc.profile);
  note("ligne d'identité", doc.tagline);
  for (const s of doc.sections)
    for (const e of s.entries) {
      note(e.id, e.heading);
      note(e.id, e.meta);
      note(e.id, e.sub);
      for (const b of e.bullets) note(b.id, b.text);
    }
  for (const s of doc.skills) note("compétences", s.items);
  return [...found].map(([p, where]) => `Emplacement non rempli ${p} (${[...where].join(", ")}) : complétez-le dans Modèle CV avant d'envoyer.`);
}

/** Texte brut du CV : faits autorisés pour la lettre de motivation. */
export function templateCvFacts(doc: TemplateCvDoc): string {
  const lines = [`Candidat : ${doc.name} — ${doc.headline}`];
  if (doc.tagline) lines.push(doc.tagline);
  lines.push(`Profil : ${doc.profile}`);
  for (const s of doc.sections) {
    lines.push(`${s.title} :`);
    for (const e of s.entries) {
      lines.push(`- ${[e.heading, e.meta].filter(Boolean).join(" · ")}${e.sub ? ` (${e.sub})` : ""}`);
      for (const b of e.bullets) lines.push(`  • ${b.text}`);
    }
  }
  lines.push(`${doc.educationTitle} :`);
  for (const e of doc.education) lines.push(`- ${[e.heading, e.meta].filter(Boolean).join(" · ")}`);
  lines.push(`${doc.skillsTitle} :`);
  for (const s of doc.skills) lines.push(`- ${s.label} : ${s.items}`);
  return lines.join("\n");
}
