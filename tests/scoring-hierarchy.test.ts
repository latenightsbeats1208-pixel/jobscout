import { describe, expect, it } from "vitest";
import { assessHierarchy, profileRanks, titleRank } from "@/lib/scoring/hierarchy";
import { profileExperienceYears } from "@/lib/scoring/seniority";
import type { ProfileFull } from "@/lib/cv/types";

/**
 * Cas de l'audit d'octobre 2026 : un directeur supply chain qui encadre 240
 * personnes voyait des postes de chef d'équipe logistique, une jeune diplômée
 * des postes de « Head of Performance » ou de « Responsable marketing digital ».
 */

describe("rang hiérarchique d'un intitulé", () => {
  it("reconnaît la direction, l'encadrement, la coordination et les postes juniors", () => {
    expect(titleRank("Directeur Supply Chain")).toBe(5);
    expect(titleRank("Head of Logistics Operations")).toBe(5);
    expect(titleRank("Responsable Marketing Digital (H/F)")).toBe(4);
    expect(titleRank("Chef d'Équipe Logistique H/F")).toBe(3);
    expect(titleRank("Chef de projet Supply Chain")).toBe(3);
    expect(titleRank("Chargée de marketing digital")).toBe(2);
    expect(titleRank("Assistant chargé d'affaires")).toBe(1);
  });

  it("un « manager » sans équipe reste un spécialiste", () => {
    expect(titleRank("Junior Account Manager - Retail Média")).toBe(1);
    expect(titleRank("Social Media Manager - CDI")).toBe(2);
    expect(titleRank("Performance Manager Confirmé (SEA & Social Ads)")).toBe(2);
    expect(titleRank("Supply Chain Manager")).toBe(4);
  });

  it("« Chef de partie » n'est pas un poste d'encadrement", () => {
    expect(titleRank("Chef de Partie H/F")).toBe(2);
  });
});

describe("encadrement demandé contre encadrement visé", () => {
  const director = profileRanks(["Directeur Supply Chain", "Head of Logistics Operations"]);
  const junior = profileRanks(["Chargée de marketing digital"]);
  const conductrice = profileRanks(["Conductrice de travaux principale", "Responsable travaux"]);

  it("un poste nettement en dessous recule pour qui ne vise que la direction", () => {
    expect(assessHierarchy(director, 20, "Chef d'Équipe Logistique H/F").factor).toBe(0.6);
    expect(assessHierarchy(director, 20, "Responsable Logistique H/F").factor).toBe(0.85);
    expect(assessHierarchy(director, 20, "Group Supply Chain Director").factor).toBe(1);
  });

  it("qui vise aussi un poste de terrain garde les postes de terrain", () => {
    expect(assessHierarchy(conductrice, 15, "Conducteur de Travaux H/F").factor).toBe(1);
  });

  it("un poste de direction recule pour un premier emploi, pas pour un profil expérimenté", () => {
    expect(assessHierarchy(junior, 1.1, "Head of Performance – Acquisition Digitale").factor).toBe(0.6);
    expect(assessHierarchy(junior, 1.1, "Responsable Marketing Digital").factor).toBe(0.6);
    expect(assessHierarchy(junior, 1.1, "Chef de Projet Marketing H/F").factor).toBe(1);
    expect(assessHierarchy(profileRanks(["Formateur"]), 10, "Responsable pédagogique").factor).toBe(1);
  });
});

describe("années d'expérience", () => {
  const profile = (experiences: { title: string; start_date: string; end_date: string; description?: string }[]) =>
    ({ experiences: experiences.map((e) => ({ company: "", bullet_points: [], skills_used: [], description: null, ...e })) }) as unknown as ProfileFull;
  const now = new Date("2026-10-14");

  it("un emploi d'été daté à l'année ne compte pas comme deux ans pleins", () => {
    // CV réel de l'audit : « Vendeuse saisonnière, étés 2022, 2023 et 2024 », daté 2022-01 → 2024-01.
    const junior = profile([
      { title: "Alternante chargée de communication digitale", start_date: "2025-09", end_date: "2026-08" },
      { title: "Stagiaire marketing", start_date: "2025-04", end_date: "2025-06" },
      { title: "Vendeuse saisonnière", start_date: "2022-01", end_date: "2024-01", description: "Vendeuse saisonnière durant les étés 2022, 2023 et 2024." },
    ]);
    expect(profileExperienceYears(junior, now)).toBe(1);
  });

  it("« a été promu » n'est pas un emploi d'été", () => {
    const p = profile([{ title: "Chef de rayon", start_date: "2020-01", end_date: "2024-01", description: "A été promu chef de rayon en 2021." }]);
    expect(profileExperienceYears(p, now)).toBe(4);
  });
});
