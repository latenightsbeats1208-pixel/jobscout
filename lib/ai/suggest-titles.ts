import "server-only";
import fs from "node:fs";
import path from "node:path";
import { callStructured, type StructuredTool } from "./llm";
import { assertNotTruncated } from "./errors";
import type { ProfileFull } from "@/lib/cv/types";
import { profileExperienceYears } from "@/lib/scoring/seniority";
import { parseTitleSuggestions, type TitleSuggestion } from "@/lib/cv/title-suggestions";

/**
 * Postes à viser suggérés à partir du profil : un appel au modèle « writer »,
 * à la demande (bouton du profil ou de l'onboarding), rien n'est enregistré —
 * la personne choisit ce qu'elle garde. Les suggestions sans appui vérifiable
 * dans le profil sont écartées (parseTitleSuggestions).
 */

const SUGGEST_TOOL: StructuredTool = {
  name: "suggest_titles",
  description: "Enregistre les intitulés de poste proposés au candidat.",
  input_schema: {
    type: "object",
    properties: {
      suggestions: {
        type: "array",
        items: {
          type: "object",
          properties: {
            intitule: { type: "string" },
            famille: { type: "string", enum: ["continuite", "evolution", "voisin"] },
            appuis: { type: "array", items: { type: "string" } },
            raison: { type: "string" },
          },
          required: ["intitule", "famille", "appuis", "raison"],
        },
      },
    },
    required: ["suggestions"],
  },
};

let _system: string | null = null;
function systemPrompt(): string {
  _system ??= fs.readFileSync(path.join(process.cwd(), "prompts", "suggest-titles.md"), "utf-8");
  return _system;
}

/** Ce que le modèle lit : le parcours et ses preuves, rien d'identifiant. */
function profilePayload(p: ProfileFull, now: Date): string {
  return JSON.stringify({
    date_du_jour: now.toISOString().slice(0, 10),
    annees_experience_totales: profileExperienceYears(p, now),
    pays_vises: p.target_countries.slice(0, 6),
    postes_vises_actuels: p.target_titles ?? [],
    resume: p.summary ?? null,
    experiences: p.experiences.slice(0, 8).map((e) => ({
      intitule: e.title,
      entreprise: e.company ?? null,
      debut: e.start_date ?? null,
      fin: e.end_date ?? null,
      realisations: e.bullet_points.slice(0, 5),
      competences: e.skills_used,
    })),
    formations: p.educations.map((e) => ({ diplome: e.degree ?? null, domaine: e.field ?? null })),
    competences: p.skills.map((s) => s.name),
    langues: p.languages.map((l) => (l.level ? `${l.name} (${l.level})` : l.name)),
  });
}

export async function suggestTitles(profile: ProfileFull, now = new Date()): Promise<TitleSuggestion[]> {
  const res = await callStructured({
    role: "writer",
    temperature: 0,
    // Les modèles qui réfléchissent avant de répondre prennent ce temps sur le même budget.
    maxTokens: 3000,
    system: systemPrompt(),
    tool: SUGGEST_TOOL,
    user: `<profil_candidat>\n${profilePayload(profile, now)}\n</profil_candidat>\n\nPropose les intitulés à chercher.`,
  });
  assertNotTruncated(res, "les suggestions de postes");
  return parseTitleSuggestions(res.input, profile, now);
}
