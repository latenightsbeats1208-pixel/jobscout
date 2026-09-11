import "server-only";
import fs from "node:fs";
import path from "node:path";
import { getClaude, MODELS } from "@/lib/ai/client";
import { AiContentError, assertNotTruncated } from "@/lib/ai/errors";
import { ExtractedCVSchema, type ExtractedCV } from "./types";

/**
 * Cap applicatif sur le texte CV envoyé à l'IA (DESIGN.md §6.4) — aligné sur
 * le cap serveur du proxy pour l'opération extract_cv (60 000 caractères).
 */
export const MAX_CV_TEXT_CHARS = 60_000;

const EXTRACT_TOOL = {
  name: "extract_cv",
  description:
    "Enregistre les informations structurées extraites du CV. Tous les champs absents doivent être null (ou tableau vide).",
  input_schema: {
    type: "object",
    properties: {
      identity: {
        type: "object",
        properties: {
          full_name: { type: ["string", "null"] },
          email: { type: ["string", "null"] },
          phone: { type: ["string", "null"] },
          location: { type: ["string", "null"] },
          linkedin_url: { type: ["string", "null"] },
          portfolio_url: { type: ["string", "null"] },
        },
        required: ["full_name", "email", "phone", "location", "linkedin_url", "portfolio_url"],
      },
      summary: { type: ["string", "null"] },
      experiences: {
        type: "array",
        items: {
          type: "object",
          properties: {
            title: { type: "string" },
            company: { type: ["string", "null"] },
            location: { type: ["string", "null"] },
            start_date: { type: ["string", "null"], description: "Format YYYY-MM" },
            end_date: { type: ["string", "null"], description: "Format YYYY-MM, ou 'present'" },
            description: { type: ["string", "null"] },
            bullet_points: { type: "array", items: { type: "string" } },
            skills_used: {
              type: "array",
              items: { type: "string" },
              description: "Compétences EXPLICITEMENT mentionnées dans cette expérience",
            },
          },
          required: [
            "title",
            "company",
            "location",
            "start_date",
            "end_date",
            "description",
            "bullet_points",
            "skills_used",
          ],
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
            location: { type: ["string", "null"] },
            start_date: { type: ["string", "null"] },
            end_date: { type: ["string", "null"] },
            description: { type: ["string", "null"] },
          },
          required: [
            "school",
            "degree",
            "field",
            "location",
            "start_date",
            "end_date",
            "description",
          ],
        },
      },
      skills: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            category: {
              type: ["string", "null"],
              enum: ["technical", "soft", "language", "tool", null],
            },
            level: {
              type: ["string", "null"],
              enum: ["beginner", "intermediate", "advanced", "expert", null],
            },
          },
          required: ["name", "category", "level"],
        },
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
      certifications: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            issuer: { type: ["string", "null"] },
            date: { type: ["string", "null"] },
          },
          required: ["name", "issuer", "date"],
        },
      },
    },
    required: ["identity", "summary", "experiences", "educations", "skills", "languages", "certifications"],
  },
} as const;

let _systemPrompt: string | null = null;
function getSystemPrompt(): string {
  if (_systemPrompt) return _systemPrompt;
  const p = path.join(process.cwd(), "prompts", "extract-cv.md");
  _systemPrompt = fs.readFileSync(p, "utf-8");
  return _systemPrompt;
}

export async function extractCV(text: string): Promise<ExtractedCV> {
  if (text.length > MAX_CV_TEXT_CHARS) {
    throw new AiContentError(
      `Ce document est trop volumineux pour l'extraction (${text.length.toLocaleString("fr-FR")} caractères, maximum ${MAX_CV_TEXT_CHARS.toLocaleString("fr-FR")}). Vérifiez qu'il s'agit bien d'un CV, ou allégez-le avant de réessayer.`,
      400
    );
  }
  const client = getClaude();
  const message = await client.messages.create({
    model: MODELS.opus,
    max_tokens: 8000,
    system: [{ type: "text", text: getSystemPrompt(), cache_control: { type: "ephemeral" } }],
    tools: [EXTRACT_TOOL as any],
    tool_choice: { type: "tool", name: "extract_cv" },
    messages: [
      {
        role: "user",
        content: `Voici le texte brut extrait d'un CV. Extrais toutes les informations dans l'outil extract_cv selon les règles fournies dans le system prompt.\n\n<cv_text>\n${text}\n</cv_text>`,
      },
    ],
  });

  assertNotTruncated(message, "l'extraction du CV");
  const toolUse = message.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new AiContentError(
      "La réponse IA pour l'extraction du CV est vide — relancez l'import du document."
    );
  }
  // Sortie hors schéma : le rapport zod (anglais, verbeux) ne doit pas remonter
  // dans l'UI — on journalise et on rend un message FR actionnable.
  const parsed = ExtractedCVSchema.safeParse(toolUse.input);
  if (!parsed.success) {
    console.error("[extractCV] sortie d'outil hors schéma :", parsed.error.issues.slice(0, 5));
    throw new AiContentError(
      "La réponse IA pour l'extraction du CV est inexploitable (structure inattendue) — relancez l'import du document."
    );
  }
  return parsed.data;
}
