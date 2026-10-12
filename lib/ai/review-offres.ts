import "server-only";
import fs from "node:fs";
import path from "node:path";
import { callStructured, type StructuredTool } from "./llm";
import type { ProfileFull } from "@/lib/cv/types";
import { profileExperienceYears } from "@/lib/scoring/seniority";
import { offerHash, parseReview, profileHash, type AiReview } from "@/lib/scoring/review";

/**
 * Relecture des meilleures offres par le modèle « reviewer » de l'utilisateur.
 * Payant : un appel par lot de BATCH_SIZE offres. L'appelant ne relit que ce
 * qui n'a pas de relecture valable en cache (voir isReviewCurrent).
 */

export const BATCH_SIZE = 8;
const DESCRIPTION_BUDGET = 2600;

const REVIEW_TOOL: StructuredTool = {
  name: "review_offres",
  description: "Enregistre la relecture de chaque offre du lot.",
  input_schema: {
    type: "object",
    properties: {
      results: {
        type: "array",
        items: {
          type: "object",
          properties: {
            offre_index: { type: "number" },
            must_haves: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  requirement: { type: "string" },
                  kind: { type: "string", enum: ["competence", "diplome", "experience", "langue", "administratif"] },
                  covered: { type: "string", enum: ["oui", "partiel", "non"] },
                  citation: { type: "string" },
                },
                required: ["requirement", "kind", "covered", "citation"],
              },
            },
            role_fit: { type: "number", minimum: 0, maximum: 100 },
            verdict: { type: "string", enum: ["postuler", "a_tenter", "hors_profil"] },
            reason: { type: "string" },
          },
          required: ["offre_index", "must_haves", "role_fit", "verdict", "reason"],
        },
      },
    },
    required: ["results"],
  },
};

let _system: string | null = null;
function systemPrompt(): string {
  _system ??= fs.readFileSync(path.join(process.cwd(), "prompts", "review-offres.md"), "utf-8");
  return _system;
}

/** Le profil tel que le modèle le lit : tout ce qui prouve une compétence, rien d'identifiant. */
function profilePayload(p: ProfileFull, now: Date): string {
  const formations = p.educations.map((e) => [e.degree, e.field].filter(Boolean).join(" — ")).filter(Boolean);
  return JSON.stringify({
    // Le modèle ne connaît pas la date : sans elle, « depuis 2023 » ne dit pas combien d'années.
    date_du_jour: now.toISOString().slice(0, 10),
    postes_vises: p.target_titles ?? [],
    resume: p.summary ?? null,
    annees_experience_totales: profileExperienceYears(p, now),
    experiences: p.experiences.slice(0, 8).map((e) => ({
      intitule: e.title,
      entreprise: e.company ?? null,
      debut: e.start_date ?? null,
      fin: e.end_date ?? null,
      duree_mois: monthsBetween(e.start_date, e.end_date, now),
      realisations: e.bullet_points.slice(0, 5),
      competences: e.skills_used,
      contexte: e.description ? e.description.slice(0, 300) : undefined,
    })),
    formations: formations.length ? formations : "non renseignée",
    competences: p.skills.map((s) => s.name),
    langues: p.languages.map((l) => (l.level ? `${l.name} (${l.level})` : l.name)),
  });
}

function monthsBetween(start: string | null | undefined, end: string | null | undefined, now: Date): number | null {
  const at = (s: string | null | undefined): number | null => {
    if (!s) return null;
    if (/^(present|aujourd|actuel|current|now|en cours)/i.test(s.trim())) return now.getFullYear() * 12 + now.getMonth();
    const m = s.match(/^(\d{4})(?:-(\d{1,2}))?/);
    return m ? Number(m[1]) * 12 + (m[2] ? Number(m[2]) - 1 : 0) : null;
  };
  const a = at(start);
  const b = at(end);
  return a !== null && b !== null && b >= a ? b - a : null;
}

const REQUIREMENTS_HEADER =
  /profil recherch[ée]|votre profil|le profil|profil souhait[ée]|comp[ée]tences (?:requises|attendues)|vos comp[ée]tences|qualifications|requirements|what you(?:'|’)ll bring|what we(?:'|’)re looking for|your profile|who you are|ce que nous recherchons|vous [êe]tes|vous avez|must have/i;

/** Le début de l'annonce (le poste) puis son bloc « profil recherché » (les exigences), dans un budget fixe. */
export function descriptionExcerpt(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= DESCRIPTION_BUDGET) return clean;
  const at = clean.search(REQUIREMENTS_HEADER);
  if (at < 0 || at < 900) return clean.slice(0, DESCRIPTION_BUDGET);
  return `${clean.slice(0, 900)} […] ${clean.slice(at, at + DESCRIPTION_BUDGET - 900)}`;
}

export type ReviewInput = {
  title: string;
  company: string;
  country: string | null;
  location?: string | null;
  contract_type?: string | null;
  description_text: string;
};

/** Relit un lot (au plus BATCH_SIZE offres) ; null pour une offre que le modèle n'a pas rendue proprement. */
async function reviewBatch(profile: ProfileFull, offres: ReviewInput[]): Promise<(AiReview | null)[]> {
  const res = await callStructured({
    role: "reviewer",
    // Deux relectures de la même annonce doivent dire la même chose.
    temperature: 0,
    // Plancher fixe en plus de la part par offre : les modèles qui réfléchissent
    // avant de répondre (Gemini Flash) prennent ce temps sur le même budget, et
    // un petit lot de 1 à 3 offres revenait tronqué, donc vide.
    maxTokens: 1500 + 500 * offres.length,
    system: [
      { text: systemPrompt(), cache: true },
      { text: `<profil_candidat>\n${profilePayload(profile, new Date())}\n</profil_candidat>`, cache: true },
    ],
    tool: REVIEW_TOOL,
    user: `Relis les ${offres.length} offres suivantes.\n\n${JSON.stringify(
      offres.map((o, i) => ({
        offre_index: i,
        intitule: o.title,
        entreprise: o.company,
        lieu: [o.location, o.country].filter(Boolean).join(", ") || null,
        contrat: o.contract_type ?? null,
        annonce: descriptionExcerpt(o.description_text),
      }))
    )}`,
  });
  const results = Array.isArray((res.input as { results?: unknown } | null)?.results)
    ? ((res.input as { results: unknown[] }).results as Record<string, unknown>[])
    : [];
  const pHash = profileHash(profile);
  return offres.map((o, i) => {
    const raw = results.find((r) => Number(r?.offre_index) === i) ?? (results.length === offres.length ? results[i] : null);
    return parseReview(raw, { profile_hash: pHash, offer_hash: offerHash(o), model: res.model }, o);
  });
}

/**
 * Relit les offres par lots, dans l'ordre. Une erreur au PREMIER lot remonte
 * (clé absente, quota, modèle introuvable : inutile de continuer) ; une erreur
 * plus tard laisse les offres du lot sans relecture.
 */
export async function reviewOffres(
  profile: ProfileFull,
  offres: ReviewInput[],
  onBatch?: (done: number, total: number) => void
): Promise<{ reviews: (AiReview | null)[]; failedBatches: number }> {
  const reviews: (AiReview | null)[] = [];
  let failedBatches = 0;
  for (let i = 0; i < offres.length; i += BATCH_SIZE) {
    const batch = offres.slice(i, i + BATCH_SIZE);
    try {
      reviews.push(...(await reviewBatch(profile, batch)));
    } catch (e) {
      if (i === 0) throw e;
      failedBatches++;
      reviews.push(...batch.map(() => null));
    }
    onBatch?.(Math.min(i + BATCH_SIZE, offres.length), offres.length);
  }
  return { reviews, failedBatches };
}
