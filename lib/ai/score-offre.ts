import "server-only";
import fs from "node:fs";
import path from "node:path";
import { getClaude, MODELS } from "./client";
import type { ProfileFull } from "@/lib/cv/types";

export type ScoreResult = {
  score: number;
  breakdown: { sector: number; skills: number; country: number };
  reason: string;
};

const SCORE_TOOL = {
  name: "score_offres",
  description: "Enregistre les scores de compatibilité pour le batch d'offres reçu.",
  input_schema: {
    type: "object",
    properties: {
      results: {
        type: "array",
        items: {
          type: "object",
          properties: {
            offre_index: { type: "number" },
            score: { type: "number", minimum: 0, maximum: 100 },
            breakdown: {
              type: "object",
              properties: {
                sector: { type: "number" },
                skills: { type: "number" },
                country: { type: "number" },
              },
              required: ["sector", "skills", "country"],
            },
            reason: { type: "string" },
          },
          required: ["offre_index", "score", "breakdown", "reason"],
        },
      },
    },
    required: ["results"],
  },
} as const;

let _systemPrompt: string | null = null;
function getSystemPrompt(): string {
  if (_systemPrompt) return _systemPrompt;
  _systemPrompt = fs.readFileSync(path.join(process.cwd(), "prompts", "score-offre.md"), "utf-8");
  return _systemPrompt;
}

function buildProfileSummary(profile: ProfileFull): string {
  const skillsAnchored = profile.skills.filter((s) => s.evidence_experience_ids.length > 0);
  const skillsListed = profile.skills.filter((s) => s.evidence_experience_ids.length === 0);
  return JSON.stringify(
    {
      sectors: profile.sectors,
      target_countries: profile.target_countries,
      skills_anchored: skillsAnchored.map((s) => s.name),
      skills_listed_only: skillsListed.map((s) => s.name),
      experience_titles: profile.experiences.map((e) => e.title).filter(Boolean),
      languages: profile.languages.map((l) => `${l.name}${l.level ? ` (${l.level})` : ""}`),
    },
    null,
    0
  );
}

export async function scoreOffres(
  profile: ProfileFull,
  offres: { title: string; company: string; country: string | null; description_text: string }[]
): Promise<ScoreResult[]> {
  if (offres.length === 0) return [];

  const client = getClaude();
  const profileSummary = buildProfileSummary(profile);

  // Truncate descriptions to keep batch reasonable; full descriptions stay in DB.
  const offresPayload = offres.map((o, i) => ({
    offre_index: i,
    title: o.title,
    company: o.company,
    country: o.country,
    description: o.description_text.slice(0, 3000),
  }));

  const message = await client.messages.create({
    model: MODELS.sonnet,
    max_tokens: 4000,
    system: [
      { type: "text", text: getSystemPrompt(), cache_control: { type: "ephemeral" } },
      {
        type: "text",
        text: `<profil_utilisateur>\n${profileSummary}\n</profil_utilisateur>`,
        cache_control: { type: "ephemeral" },
      },
    ],
    tools: [SCORE_TOOL as any],
    tool_choice: { type: "tool", name: "score_offres" },
    messages: [
      {
        role: "user",
        content: `Score les ${offres.length} offres ci-dessous.\n\n${JSON.stringify(offresPayload)}`,
      },
    ],
  });

  const toolUse = message.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    return offres.map(() => ({ score: 0, breakdown: { sector: 0, skills: 0, country: 0 }, reason: "" }));
  }
  const out = (toolUse.input as { results: any[] }).results || [];
  const ordered: ScoreResult[] = offres.map((_, i) => {
    const r = out.find((x: any) => x.offre_index === i);
    if (!r) return { score: 0, breakdown: { sector: 0, skills: 0, country: 0 }, reason: "" };
    return {
      score: Math.round(r.score),
      breakdown: r.breakdown,
      reason: r.reason ?? "",
    };
  });
  return ordered;
}
