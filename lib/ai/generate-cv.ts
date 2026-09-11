import "server-only";
import fs from "node:fs";
import path from "node:path";
import { getClaude, MODELS } from "./client";
import { compareRecentFirst, parseGeneratedCV } from "./cv-shape";
import { AiContentError, assertNotTruncated } from "./errors";
import { validateCVAgainstProfile } from "./validate";
import { proofreadCV, translateToEnglish } from "./proofread";
import { cvLanguageInstruction } from "./lang-prompts";
import { detectDocLanguage, sourceLanguageHint, type DocLang } from "@/lib/text/lang";
import type { ProfileFull } from "@/lib/cv/types";
import type { OffreFiltered } from "@/lib/db/offres";

export type GeneratedCV = {
  identity: {
    full_name: string;
    email: string | null;
    phone: string | null;
    location: string | null;
    linkedin_url: string | null;
    portfolio_url: string | null;
  };
  summary: string;
  sections: {
    experiences: {
      title: string;
      company: string | null;
      location: string | null;
      start_date: string | null;
      end_date: string | null;
      bullet_points: string[];
    }[];
    educations: {
      school: string;
      degree: string | null;
      field: string | null;
      start_date: string | null;
      end_date: string | null;
      bullet_points: string[];
    }[];
    skills_flat: string[];
    languages: { name: string; level: string | null }[];
    projects: {
      name: string;
      role: string | null;
      start_date: string | null;
      end_date: string | null;
      bullet_points: string[];
    }[];
  };
};

const TOOL = {
  name: "build_cv",
  description: "Construit le CV optimisé pour l'offre.",
  input_schema: {
    type: "object",
    properties: {
      identity: {
        type: "object",
        properties: {
          full_name: { type: "string" },
          email: { type: ["string", "null"] },
          phone: { type: ["string", "null"] },
          location: { type: ["string", "null"] },
          linkedin_url: { type: ["string", "null"] },
          portfolio_url: { type: ["string", "null"] },
        },
        required: ["full_name", "email", "phone", "location", "linkedin_url", "portfolio_url"],
      },
      summary: { type: "string" },
      sections: {
        type: "object",
        properties: {
          experiences: {
            type: "array",
            items: {
              type: "object",
              properties: {
                title: { type: "string" },
                company: { type: ["string", "null"] },
                location: { type: ["string", "null"] },
                start_date: { type: ["string", "null"] },
                end_date: { type: ["string", "null"] },
                bullet_points: { type: "array", items: { type: "string" } },
              },
              required: ["title", "company", "location", "start_date", "end_date", "bullet_points"],
            },
          },
          educations: {
            type: "array",
            items: {
              type: "object",
              properties: {
                school: { type: "string" },
                degree: { type: ["string", "null"] },
                field: { type: ["string", "null"] },
                start_date: { type: ["string", "null"] },
                end_date: { type: ["string", "null"] },
                bullet_points: { type: "array", items: { type: "string" } },
              },
              required: ["school", "degree", "field", "start_date", "end_date", "bullet_points"],
            },
          },
          projects: {
            type: "array",
            description:
              "Projets entrepreneuriaux ou personnels (création d'entreprise, chaîne, communauté, association…) — JAMAIS dans experiences. Section rendue APRÈS les expériences salariées. 0 ou 1 projet, 2-3 puces.",
            items: {
              type: "object",
              properties: {
                name: { type: "string" },
                role: { type: ["string", "null"] },
                start_date: { type: ["string", "null"] },
                end_date: { type: ["string", "null"] },
                bullet_points: { type: "array", items: { type: "string" } },
              },
              required: ["name", "role", "start_date", "end_date", "bullet_points"],
            },
          },
          skills_flat: {
            type: "array",
            items: { type: "string" },
            description: "Liste à plat de compétences/outils, pipe-séparés au rendu (ex. 'gestion de projet | KPI | Power BI'). Inclure les langages, frameworks, méthodologies, outils. Pas de catégories.",
          },
          languages: {
            type: "array",
            items: {
              type: "object",
              properties: {
                name: { type: "string" },
                level: { type: ["string", "null"] },
              },
              required: ["name", "level"],
            },
          },
        },
        required: ["experiences", "educations", "skills_flat", "languages"],
      },
    },
    required: ["identity", "summary", "sections"],
  },
} as const;

let _system: string | null = null;

/**
 * `lang` : langue du document (déduite de l'offre par défaut). Elle est
 * imposée au modèle, au validateur, à la relecture et aux templates.
 */
export async function generateCV(
  profile: ProfileFull,
  offre: OffreFiltered,
  lang: DocLang = detectDocLanguage(offre.title, offre.description_text, sourceLanguageHint(offre.source, offre.raw_payload), offre.country)
): Promise<GeneratedCV> {
  if (!_system) _system = fs.readFileSync(path.join(process.cwd(), "prompts", "generate-cv.md"), "utf-8");
  const client = getClaude();
  // CV en anglais : le vocabulaire de compétences du profil (français) est
  // traduit une fois, en parallèle de la génération, pour que l'ancrage
  // anti-hallucination reconnaisse les compétences traduites par le modèle.
  const vocab =
    lang === "en"
      ? [...new Set([...profile.skills.map((s) => s.name), ...profile.experiences.flatMap((e) => e.skills_used ?? [])].filter(Boolean))]
      : [];
  const vocabPromise = vocab.length ? translateToEnglish(vocab, "profile-skills") : null;
  // Levier cache (DESIGN.md §6.5, motif score-offre.ts) : le profil vit dans un
  // 2ᵉ bloc system avec cache_control sur LES DEUX blocs — en mode pack, le
  // préfixe tools+prompt est partagé entre tous les utilisateurs via la clé
  // unique du proxy, et le profil est réutilisé d'une offre à l'autre pendant
  // un burst de candidatures. Le bloc user ne garde que l'offre + la consigne.
  const message = await client.messages.create({
    model: MODELS.opus,
    max_tokens: 4000,
    system: [
      { type: "text", text: _system, cache_control: { type: "ephemeral" } },
      {
        type: "text",
        text: `## Profil utilisateur\n${JSON.stringify(stripIds(profile), null, 2)}`,
        cache_control: { type: "ephemeral" },
      },
    ],
    tools: [TOOL as any],
    tool_choice: { type: "tool", name: "build_cv" },
    messages: [
      {
        role: "user",
        content: `${cvLanguageInstruction(lang)}

## Offre cible\n- Titre: ${offre.title}\n- Entreprise: ${offre.company}\n- Pays: ${offre.country ?? ""}\n- Description:\n${offre.description_text.slice(0, 6000)}\n\nGénère le CV optimisé${lang === "en" ? " — entièrement en anglais" : ""}.`,
      },
    ],
  });
  assertNotTruncated(message, "le CV");
  const t = message.content.find((b) => b.type === "tool_use");
  if (!t || t.type !== "tool_use")
    throw new AiContentError(
      "La réponse IA pour le CV est vide (aucun contenu structuré) — relancez la génération."
    );
  // Validation d'EXÉCUTION, jamais un cast nu : le proxy a déjà répondu 200 et
  // débité les points, un plantage ici serait payé sans rien livrer.
  const raw = parseGeneratedCV(t.input);
  // Anti-hallucination : strip companies/skills not anchored in the profile
  const vocabEn = vocabPromise ? await vocabPromise : [];
  // strict = la traduction a bien eu lieu ; sinon (échec silencieux du
  // traducteur) le validateur garde les compétences génériques avec avertissement.
  const validation = vocabEn.length
    ? { extraKnownSkills: vocabEn, strict: vocabEn.some((v, i) => v !== vocab[i]) }
    : {};
  const { cv: validated, report } = validateCVAgainstProfile(raw, profile, lang, validation);
  if (report.warnings.length > 0) {
    console.log(
      `[generateCV] anti-hallucination: ${report.stripped.experiences} exp + ${report.stripped.skills} skills supprimées`
    );
    for (const w of report.warnings) console.log(`  • ${w}`);
  }
  // Relecture (orthographe, accords, typographie, faits non étayés) — jamais bloquante.
  return proofreadCV(enforceAtsLimits(validated), profile, lang);
}

/**
 * Hard guards to keep the CV on a single page even if the model overshoots the prompt limits.
 * - Max 4 experiences (most recent first; the model already sorts but we re-sort defensively)
 * - Max 3 bullet points per experience
 * - Max 3 educations
 * - Summary trimmed to ~55 words
 */
function enforceAtsLimits(cv: GeneratedCV): GeneratedCV {
  const sortedExp = [...cv.sections.experiences].sort(compareRecentFirst);
  const experiences = sortedExp.slice(0, 4).map((e) => ({
    ...e,
    bullet_points: (e.bullet_points ?? []).slice(0, 4),
  }));
  const educations = [...cv.sections.educations].sort(compareRecentFirst).slice(0, 3).map((e) => ({
    ...e,
    bullet_points: (e.bullet_points ?? []).slice(0, 2),
  }));

  let summary = cv.summary ?? "";
  const words = summary.split(/\s+/);
  if (words.length > 90) summary = words.slice(0, 90).join(" ").replace(/[,;:]?$/, "") + ".";

  // Cap skills_flat at 25 to keep one line at the bottom of the page
  const skills_flat = (cv.sections.skills_flat ?? []).slice(0, 25);
  // Projet entrepreneurial : au plus un, 3 puces — il ne doit jamais évincer une expérience salariée.
  const projects = (cv.sections.projects ?? []).slice(0, 1).map((p) => ({
    ...p,
    bullet_points: (p.bullet_points ?? []).slice(0, 3),
  }));

  return {
    ...cv,
    summary,
    sections: {
      ...cv.sections,
      experiences,
      educations,
      skills_flat,
      projects,
    },
  };
}

function stripIds(p: ProfileFull) {
  return {
    identity: {
      full_name: p.full_name,
      email: p.email,
      phone: p.phone,
      location: p.location,
      linkedin_url: p.linkedin_url,
      portfolio_url: p.portfolio_url,
    },
    summary: p.summary,
    experiences: p.experiences.map((e) => ({
      title: e.title,
      company: e.company,
      location: e.location,
      start_date: e.start_date,
      end_date: e.end_date,
      description: e.description,
      bullet_points: e.bullet_points,
      skills_used: e.skills_used,
    })),
    educations: p.educations,
    skills: p.skills.map((s) => ({
      name: s.name,
      category: s.category,
      level: s.level,
      anchored: s.evidence_experience_ids.length > 0,
    })),
    languages: p.languages,
  };
}
