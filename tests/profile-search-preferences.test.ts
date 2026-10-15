import { describe, expect, it } from "vitest";
import { buildProfileFromExtraction } from "@/lib/cv/validate";
import { searchAreaFromText } from "@/lib/geo/locate";
import { scoreOffreLocal } from "@/lib/scoring/local";
import type { ExtractedCV, ProfileFull } from "@/lib/cv/types";

/**
 * Ce que le CV dit de la recherche pré-remplit l'inscription. Avant, « En
 * Alsace ou côté allemand, CDI », « France ou Espagne » ou « mission freelance
 * ou CDI full remote » restaient sans effet et devaient être ressaisis, et le
 * freelance comme le télétravail complet n'existaient pas (audit d'octobre 2026).
 */

const extracted = (location: string | null, search_preferences: ExtractedCV["search_preferences"]): ExtractedCV => ({
  identity: { full_name: "X", email: null, phone: null, location, linkedin_url: null, portfolio_url: null },
  summary: null,
  target_titles: [],
  experiences: [],
  educations: [],
  skills: [],
  languages: [],
  certifications: [],
  search_preferences,
});

describe("zone écrite en texte libre", () => {
  it("un lieu, plusieurs lieux d'une même région, une région", () => {
    expect(searchAreaFromText("Bordeaux")).toBe("D:33");
    expect(searchAreaFromText("Strasbourg (67)")).toBe("D:67");
    expect(searchAreaFromText("Seine-Saint-Denis ou Paris")).toBe("R:11");
    expect(searchAreaFromText("Île-de-France")).toBe("R:11");
    expect(searchAreaFromText("En Alsace ou côté allemand")).toBeNull();
    expect(searchAreaFromText(null)).toBeNull();
  });
});

describe("préférences de recherche tirées du CV", () => {
  it("reprend zone, pays, contrats et télétravail écrits dans le CV", () => {
    const p = buildProfileFromExtraction(
      extracted("Montreuil (93)", { zone: "Seine-Saint-Denis ou Paris", countries: ["France"], contracts: ["cdi", "cdd"], remote: null }),
      ""
    );
    expect(p).toMatchObject({ search_area: "R:11", target_countries: ["France"], preferred_contracts: ["cdi", "cdd"], remote: "" });
  });

  it("sans zone utilisable, le lieu de résidence ; les pays nommés sont gardés", () => {
    const p = buildProfileFromExtraction(
      extracted("Strasbourg (67)", { zone: "En Alsace ou côté allemand", countries: ["France", "Allemagne"], contracts: ["cdi"], remote: null }),
      ""
    );
    expect(p).toMatchObject({ search_area: "D:67", target_countries: ["France", "Allemagne"], preferred_contracts: ["cdi"] });
  });

  it("freelance et télétravail complet", () => {
    const p = buildProfileFromExtraction(
      extracted("Brest (29)", { zone: null, countries: [], contracts: ["freelance", "cdi"], remote: true }),
      ""
    );
    expect(p).toMatchObject({ search_area: "D:29", target_countries: ["France"], preferred_contracts: ["freelance", "cdi"], remote: "full" });
  });

  it("un CV muet garde les défauts d'avant", () => {
    const p = buildProfileFromExtraction(extracted(null, null), "");
    expect(p).toMatchObject({ search_area: "", target_countries: [], preferred_contracts: ["cdi", "cdd"], remote: "" });
  });
});

describe("dans la note", () => {
  const profile = (over: Partial<ProfileFull>) =>
    ({
      full_name: null, sectors: [], target_titles: ["Développeur PHP"], target_countries: ["France"], search_area: "D:29",
      sources_enabled: [], preferred_contracts: ["cdi"], extraction_confidence: 90, remote: "",
      experiences: [{ title: "Développeur PHP", company: "Agence", start_date: "2019-01", end_date: "present", bullet_points: [], skills_used: ["Symfony"] }],
      educations: [], skills: [{ name: "Symfony", evidence_experience_ids: [0] }], languages: [{ name: "Français", level: "Natif" }],
      ...over,
    }) as unknown as ProfileFull;
  const offer = (over: object) => ({
    title: "Développeur PHP Symfony H/F", company: "Éditeur", country: "France", location: "Nantes", contract_type: "CDI",
    description_text: "Vous développez nos API Symfony. Poste en télétravail complet, partout en France.", ...over,
  });

  it("une mission freelance n'est plus en retrait pour qui en cherche une", () => {
    const mission = offer({ contract_type: "Freelance" });
    const salaried = scoreOffreLocal(profile({}), mission);
    const freelancer = scoreOffreLocal(profile({ preferred_contracts: ["freelance", "cdi"] }), mission);
    expect(freelancer.score).toBeGreaterThan(salaried.score);
    expect(salaried.breakdown.minus).toBe("freelance");
    expect(freelancer.breakdown.minus).toBeUndefined();
  });

  it("le télétravail complet recherché fait passer devant une offre qui le propose", () => {
    const remote = scoreOffreLocal(profile({ remote: "full" }), offer({}));
    const indifferent = scoreOffreLocal(profile({}), offer({}));
    expect(remote.score).toBe(indifferent.score + 5);
    expect(remote.breakdown.plus).toMatch(/en télétravail complet$/);
  });
});
