import "server-only";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { callStructured, type StructuredTool } from "./llm";
import { AiContentError, assertNotTruncated } from "./errors";
import { profileFacts } from "./profile-facts";
import type { ProfileFull } from "@/lib/cv/types";
import type { OffreFiltered } from "@/lib/db/offres";

const TOOL = {
  name: "build_interview_prep",
  description: "Prépare des questions et des pistes d'entretien adaptées au profil et à l'offre.",
  input_schema: {
    type: "object",
    properties: {
      overview: { type: "string" },
      questions: {
        type: "array",
        items: {
          type: "object",
          properties: {
            question: { type: "string" },
            rationale: { type: "string" },
            relevant_experience_indexes: { type: "array", items: { type: "integer" } },
          },
          required: ["question", "rationale", "relevant_experience_indexes"],
        },
      },
      questions_to_ask: { type: "array", items: { type: "string" } },
    },
    required: ["overview", "questions", "questions_to_ask"],
  },
} as const;

const PrepSchema = z.object({
  overview: z.string().min(1),
  questions: z.array(z.object({
    question: z.string().min(1),
    rationale: z.string().min(1),
    relevant_experience_indexes: z.array(z.number().int()),
  })).min(4).max(8),
  questions_to_ask: z.array(z.string().min(1)).min(3).max(6),
});

export type InterviewPrep = z.infer<typeof PrepSchema>;

let systemPrompt: string | null = null;

export async function generateInterviewPrep(
  profile: ProfileFull,
  offre: OffreFiltered
): Promise<InterviewPrep> {
  if (!systemPrompt) {
    systemPrompt = fs.readFileSync(path.join(process.cwd(), "prompts", "interview-prep.md"), "utf-8");
  }
  const message = await callStructured({
    role: "writer",
    maxTokens: 3500,
    system: [{ text: systemPrompt, cache: true }],
    tool: TOOL as unknown as StructuredTool,
    user: `## Profil réel du candidat\n${profileFacts(profile)}\n\n## Offre cible\nTitre : ${offre.title}\nEntreprise : ${offre.company}\nLieu : ${[offre.location, offre.country].filter(Boolean).join(", ")}\nDescription :\n${offre.description_text.slice(0, 6000)}\n\nLes index d'expérience doivent correspondre à l'ordre des expériences du profil (0 = première). Prépare l'entretien en français.`,
  });
  assertNotTruncated(message, "la préparation d'entretien");
  const parsed = PrepSchema.safeParse(message.input);
  if (!parsed.success) {
    throw new AiContentError("La préparation d'entretien renvoyée par l'IA est inexploitable — relancez la génération.");
  }
  return {
    ...parsed.data,
    questions: parsed.data.questions.map((item) => ({
      ...item,
      relevant_experience_indexes: [...new Set(item.relevant_experience_indexes)].filter(
        (index) => index >= 0 && index < profile.experiences.length
      ),
    })),
  };
}
