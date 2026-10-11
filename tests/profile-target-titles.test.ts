import { describe, expect, it } from "vitest";
import { getProfile, saveProfile } from "@/lib/db/queries";
import { mergeProfile } from "@/lib/cv/merge";
import type { ProfileFull } from "@/lib/cv/types";

const base: Omit<ProfileFull, "id" | "created_at" | "updated_at"> = {
  full_name: "Camille Martin",
  sectors: ["assurance"],
  target_titles: ["Business Analyst", "Consultant AMOA"],
  target_countries: ["France"],
  sources_enabled: ["wttj"],
  preferred_contracts: ["cdi"],
  extraction_confidence: 80,
  experiences: [],
  educations: [],
  skills: [],
  languages: [],
};

describe("postes visés", () => {
  it("sont enregistrés et relus avec le profil", () => {
    saveProfile(base);
    expect(getProfile()?.target_titles).toEqual(["Business Analyst", "Consultant AMOA"]);
  });

  it("ceux déjà choisis l'emportent sur ceux d'un nouveau CV", () => {
    const current = { ...base, target_titles: ["Business Analyst"] } as ProfileFull;
    const incoming = { ...base, target_titles: ["Chef de projet"] } as ProfileFull;
    expect(mergeProfile(current, incoming).target_titles).toEqual(["Business Analyst"]);
    expect(mergeProfile({ ...current, target_titles: [] }, incoming).target_titles).toEqual(["Chef de projet"]);
  });
});
