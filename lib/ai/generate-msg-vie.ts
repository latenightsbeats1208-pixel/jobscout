import "server-only";
import fs from "node:fs";
import path from "node:path";
import { getClaude, MODELS } from "./client";
import { AiContentError, assertNotTruncated } from "./errors";
import type { ProfileFull } from "@/lib/cv/types";
import type { OffreFiltered } from "@/lib/db/offres";
import { msgLanguageInstruction } from "./lang-prompts";
import { detectDocLanguage, sourceLanguageHint, type DocLang } from "@/lib/text/lang";

/**
 * MSG V.I.E generator — ported from the original Python Job Scout.
 *
 * Differences vs previous Sonnet/single-string approach:
 * - Uses Claude Opus 4.7 (higher quality, important for short messages
 *   where every word counts)
 * - Returns a structured 3-line JSON (intro / skills / availability)
 *   instead of a free-form string. This naturally caps length and forces
 *   the model to be specific.
 * - Drops the 3-attempt "shrink until <2000 chars" loop : with a structured
 *   output of ~500-900 chars there is no overshoot to handle.
 *
 * The API route still receives a single concatenated string for backward
 * compatibility — the structure exists purely on the model side.
 */

export type GeneratedMsgVie = {
  intro_line: string;
  skills_pitch: string;
  availability_line: string;
};

const TOOL = {
  name: "build_msg_vie",
  description:
    "Construit le message Civiweb / Business France en 3 lignes structurées.",
  input_schema: {
    type: "object",
    properties: {
      intro_line: {
        type: "string",
        description:
          "1 phrase : diplôme + années d'expérience + domaine clé + intérêt pour le poste exact chez l'entreprise.",
      },
      skills_pitch: {
        type: "string",
        description:
          "1 à 2 phrases : 2-4 compétences exactes du profil les plus pertinentes pour l'offre, liées à la mission.",
      },
      availability_line: {
        type: "string",
        description:
          "1 phrase : langues maîtrisées + disponibilité pour la durée du V.I.E.",
      },
    },
    required: ["intro_line", "skills_pitch", "availability_line"],
  },
} as const;

// Prompt content is read lazily on first call. Bump the suffix to force a
// re-read after editing the markdown file in dev (HMR resets module state).
let _system: string | null = null; // v2 — language-honesty rule

function buildUserPrompt(profile: ProfileFull, offre: OffreFiltered, lang: DocLang): string {
  const expSummary = profile.experiences
    .slice(0, 4)
    .map(
      (e) =>
        `${e.title}${e.company ? ` — ${e.company}` : ""}${
          e.start_date || e.end_date
            ? ` (${e.start_date ?? "?"}→${
                e.end_date === "present" ? "auj." : e.end_date ?? "?"
              })`
            : ""
        }`
    )
    .join(" ; ");

  const eduSummary = profile.educations
    .slice(0, 2)
    .map(
      (e) =>
        `${e.degree ?? "Diplôme"}${e.field ? ` — ${e.field}` : ""}${
          e.school ? ` (${e.school})` : ""
        }`
    )
    .join(" ; ");

  const skillsAnchored = profile.skills
    .filter((s) => s.evidence_experience_ids.length > 0)
    .map((s) => s.name)
    .slice(0, 20);
  const skillsListed = profile.skills
    .filter((s) => s.evidence_experience_ids.length === 0)
    .map((s) => s.name)
    .slice(0, 10);

  const languages = profile.languages
    .map((l) => `${l.name}${l.level ? ` (${l.level})` : ""}`)
    .join(", ");

  return `${msgLanguageInstruction(lang)}

## Profil candidat (référentiel — ne rien inventer hors de ce JSON)

Nom: ${profile.full_name ?? ""}
Formation: ${eduSummary || "(non renseignée)"}
Expériences récentes: ${expSummary || "(aucune)"}
Compétences ancrées (utilisées en mission): ${
    skillsAnchored.join(", ") || "(aucune)"
  }
Compétences listées seules: ${skillsListed.join(", ") || "(aucune)"}
Langues: ${languages || "(non renseignées)"}

## Offre V.I.E cible
- Intitulé du poste: ${offre.title}
- Entreprise: ${offre.company}
- Pays: ${offre.country ?? "(non précisé)"}
- Ville: ${offre.location ?? ""}
- Contrat: ${offre.contract_type ?? "V.I.E"}
${offre.salary ? `- Indemnité: ${offre.salary}\n` : ""}
- Description complète:
${offre.description_text.slice(0, 4500)}

Rédige le message en 3 lignes via l'outil. Cible ~500-900 caractères au total.`;
}

export async function generateMsgVie(
  profile: ProfileFull,
  offre: OffreFiltered,
  lang: DocLang = detectDocLanguage(offre.title, offre.description_text, sourceLanguageHint(offre.source, offre.raw_payload), offre.country)
): Promise<string> {
  if (!_system) {
    _system = fs.readFileSync(
      path.join(process.cwd(), "prompts", "generate-msg-vie.md"),
      "utf-8"
    );
  }
  const client = getClaude();
  const message = await client.messages.create({
    model: MODELS.opus,
    max_tokens: 1200,
    system: [
      { type: "text", text: _system, cache_control: { type: "ephemeral" } },
    ],
    tools: [TOOL as any],
    tool_choice: { type: "tool", name: "build_msg_vie" },
    messages: [{ role: "user", content: buildUserPrompt(profile, offre, lang) }],
  });
  assertNotTruncated(message, "le message V.I.E");
  const t = message.content.find((b) => b.type === "tool_use");
  if (!t || t.type !== "tool_use")
    throw new AiContentError(
      "La réponse IA pour le message V.I.E est vide — relancez la génération."
    );
  // Lecture défensive : la sortie d'outil n'est pas garantie conforme au schéma.
  const out = (t.input ?? {}) as Partial<GeneratedMsgVie>;
  const line = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

  const intro = line(out.intro_line);
  const skills = line(out.skills_pitch);
  const avail = line(out.availability_line);

  // Concatenate the 3 lines into a single message body. Blank line between
  // the three for readability when pasted into Civiweb.
  const text = [intro, skills, avail].filter(Boolean).join("\n\n");

  // Sans ce garde-fou, une sortie d'outil sans les champs attendus produisait
  // un document VIDE écrit sur disque, avec ok:true et length:0 côté route.
  if (text.length < 50) {
    throw new AiContentError(
      "La réponse IA pour le message V.I.E est inexploitable (contenu vide) — relancez la génération."
    );
  }

  // Defensive hard cap (should never trigger with structured output)
  if (text.length > 2000) {
    return text.slice(0, 1990).replace(/[^.!?]*$/, "").trim() + ".";
  }
  return text;
}
