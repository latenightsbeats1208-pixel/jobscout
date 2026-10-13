import { describe, expect, it } from "vitest";
import type { ProfileFull } from "@/lib/cv/types";
import { localTitleSuggestions, parseTitleSuggestions } from "@/lib/cv/title-suggestions";

/**
 * Postes suggérés à partir du CV : le modèle propose, la vérification garde.
 * Profil fictif calqué sur un cas réel : 4 ans de vente, deux stages, un master
 * en échanges internationaux, CV en anglais.
 */

const NOW = new Date("2026-10-12T12:00:00Z");

const profile = {
  full_name: null, email: null, phone: null, location: null, linkedin_url: null, portfolio_url: null,
  summary: null, raw_cv_text: null, sectors: [], target_titles: ["Business Developer"], target_countries: ["France", "Belgique"],
  search_area: "", sources_enabled: [], preferred_contracts: ["cdi"], extraction_confidence: 80,
  experiences: [
    { title: "Sales Representative", company: "Exemple Electronics", start_date: "2022-01", end_date: "2026-10", bullet_points: [], skills_used: ["Négociation"] },
    { title: "Marketing Assistant Intern", company: "Exemple Santé", start_date: "2023-04", end_date: "2023-06", bullet_points: [], skills_used: [] },
  ],
  educations: [{ school: "Université", degree: "Master's Degree", field: "Administration and International Exchanges" }],
  skills: [{ name: "Cross-Cultural Communication" }, { name: "Project Management" }],
  languages: [{ name: "Anglais", level: "C1" }, { name: "Espagnol" }],
} as unknown as ProfileFull;

const s = (intitule: string, famille: string, appuis: string[], raison = "Parce que.") => ({ intitule, famille, appuis, raison });

describe("suggestions de postes", () => {
  it("garde une suggestion appuyée sur le profil, au libellé exact du profil", () => {
    const [first] = parseTitleSuggestions({ suggestions: [s("Chargé de développement export (H/F)", "voisin", ["administration and international exchanges", "Espagnol"])] }, profile, NOW);
    expect(first).toEqual({
      title: "Chargé de développement export",
      family: "voisin",
      reason: "Parce que.",
      evidence: ["Administration and International Exchanges", "Espagnol"],
    });
  });

  it("écarte une suggestion sans appui réel (appui inventé)", () => {
    const out = parseTitleSuggestions({ suggestions: [s("Data Analyst", "voisin", ["Python", "SQL"]), s("Commercial terrain", "continuite", ["Sales Representative"])] }, profile, NOW);
    expect(out.map((x) => x.title)).toEqual(["Commercial terrain"]);
  });

  it("écarte un niveau hors de portée, les stages et les postes déjà visés", () => {
    const out = parseTitleSuggestions({
      suggestions: [
        s("Head of Sales", "evolution", ["Sales Representative"]), // niveau 8 pour ~4 ans
        s("Directeur commercial", "evolution", ["Sales Representative"]),
        s("Stage marketing", "voisin", ["Marketing Assistant Intern"]),
        s("business developer", "continuite", ["Sales Representative"]), // déjà visé
        s("Responsable grands comptes", "evolution", ["Sales Representative", "Négociation"]),
        s("Responsable grands comptes", "evolution", ["Sales Representative"]), // doublon
        s("Chef de projet international", "inconnue", ["Project Management"]), // famille inconnue
      ],
    }, profile, NOW);
    expect(out.map((x) => x.title)).toEqual(["Responsable grands comptes"]);
  });

  it("réponse illisible : aucune suggestion", () => {
    expect(parseTitleSuggestions(null, profile, NOW)).toEqual([]);
    expect(parseTitleSuggestions({ suggestions: "x" }, profile, NOW)).toEqual([]);
  });

  it("sans IA : les intitulés des expériences, hors stage et poste déjà visé", () => {
    expect(localTitleSuggestions(profile).map((x) => x.title)).toEqual(["Sales Representative"]);
  });
});
