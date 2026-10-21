import { describe, expect, it } from "vitest";
import { scoreOffreLocal } from "@/lib/scoring/local";
import { offre, profile } from "./fixtures";

describe("explication du score de compatibilité", () => {
  it("retourne les mots-clés correspondants et les compétences non mentionnées", () => {
    const enrichedProfile = {
      ...profile,
      skills: [...profile.skills, {
        id: 33,
        name: "Excel",
        category: "tool" as const,
        level: "advanced" as const,
        evidence_experience_ids: [],
      }],
    };
    const result = scoreOffreLocal(enrichedProfile, offre);
    expect(result.breakdown.matched_sectors).toContain("digital");
    expect(result.breakdown.matched_skills).toEqual(expect.arrayContaining(["Gestion de projet", "SQL"]));
    expect(result.breakdown.profile_skills_not_in_offer).toContain("Excel");
  });
});
