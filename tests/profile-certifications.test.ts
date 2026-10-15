import { describe, expect, it } from "vitest";
import { getProfile, saveProfile } from "@/lib/db/queries";
import { mergeProfile } from "@/lib/cv/merge";
import { buildProfileFromExtraction } from "@/lib/cv/validate";
import { profileHash } from "@/lib/scoring/review";
import type { ExtractedCV, ProfileFull } from "@/lib/cv/types";

/**
 * L'extraction relevait les certifications, mais le profil n'avait pas de place
 * pour elles : la carte CNAPS, le CQP APS et le SST d'un agent de sécurité se
 * perdaient à l'import (audit d'octobre 2026).
 */

const base: Omit<ProfileFull, "id" | "created_at" | "updated_at"> = {
  full_name: "Moussa Traoré",
  sectors: [],
  target_titles: ["Agent de sécurité incendie SSIAP 1"],
  target_countries: ["France"],
  search_area: "R:11",
  sources_enabled: ["francetravail"],
  preferred_contracts: ["cdi", "cdd"],
  extraction_confidence: 80,
  experiences: [],
  educations: [],
  skills: [],
  languages: [],
};

const extracted = (certifications: ExtractedCV["certifications"]): ExtractedCV => ({
  identity: { full_name: "Moussa Traoré", email: null, phone: null, location: null, linkedin_url: null, portfolio_url: null },
  summary: null,
  target_titles: ["Agent de sécurité incendie SSIAP 1"],
  experiences: [],
  educations: [],
  skills: [],
  languages: [],
  certifications,
});

describe("certifications du profil", () => {
  it("passent de l'extraction au profil, dédoublonnées", () => {
    const p = buildProfileFromExtraction(
      extracted([
        { name: "SSIAP 1", issuer: null, date: "2014, recyclage 2023" },
        { name: "Carte professionnelle CNAPS", issuer: null, date: "valide jusqu'en 2028" },
        { name: "ssiap 1", issuer: "INFS", date: null },
      ]),
      ""
    );
    expect(p.certifications).toEqual([
      { name: "SSIAP 1", issuer: "INFS", date: "2014, recyclage 2023" },
      { name: "Carte professionnelle CNAPS", issuer: null, date: "valide jusqu'en 2028" },
    ]);
  });

  it("sont enregistrées et relues avec le profil", () => {
    saveProfile({ ...base, certifications: [{ name: "SST", issuer: null, date: "à jour" }] });
    expect(getProfile()?.certifications).toMatchObject([{ name: "SST", issuer: null, date: "à jour" }]);
  });

  it("un nouveau CV ajoute les siennes sans doublon", () => {
    const current = { ...base, certifications: [{ name: "SSIAP 1" }] } as ProfileFull;
    const incoming = { ...base, certifications: [{ name: "SSIAP 1" }, { name: "CQP APS" }] } as ProfileFull;
    expect(mergeProfile(current, incoming).certifications?.map((c) => c.name)).toEqual(["SSIAP 1", "CQP APS"]);
  });

  it("un profil sans certification garde ses relectures par l'IA en cache", () => {
    const p = base as ProfileFull;
    expect(profileHash({ ...p, certifications: [] })).toBe(profileHash(p));
    expect(profileHash({ ...p, certifications: [{ name: "SSIAP 2" }] })).not.toBe(profileHash(p));
  });
});
