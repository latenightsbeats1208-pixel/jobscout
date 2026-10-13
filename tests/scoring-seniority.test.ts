import { describe, expect, it } from "vitest";
import { assessSeniority, profileExperienceYears, requiredYearsFromDescription, titleLevel } from "@/lib/scoring/seniority";
import { tokenize } from "@/lib/scoring/text";
import type { ProfileFull } from "@/lib/cv/types";

describe("expérience demandée par l'annonce", () => {
  it("lit les tournures relevées dans de vraies annonces", () => {
    expect(requiredYearsFromDescription("Profil recherché : minimum 10 à 15 ans d'expérience globale")).toBe(10);
    expect(requiredYearsFromDescription("Tu justifies d'au moins 10 ans d'expérience en tant que lead")).toBe(10);
    expect(requiredYearsFromDescription("Vous avez une expérience de 8 ans minimum en développement")).toBe(8);
    expect(requiredYearsFromDescription("Vous justifiez d'une expérience significative d'au moins 6 ans")).toBe(6);
    expect(requiredYearsFromDescription("3 ans d'expérience minimum sur un poste similaire")).toBe(3);
    expect(requiredYearsFromDescription("5+ ans d'expérience en Java")).toBe(5);
    expect(requiredYearsFromDescription("You have 4+ years of professional experience with Go")).toBe(4);
    expect(requiredYearsFromDescription("At least 3 years in a customer-facing role")).toBe(3);
    expect(requiredYearsFromDescription("3-5 years experience in B2B sales")).toBe(3);
  });

  it("retient la durée la plus faible quand l'annonce en cite plusieurs", () => {
    expect(
      requiredYearsFromDescription("5 ans d'expérience en développement, dont 2 ans d'expérience en management")
    ).toBe(2);
  });

  it("ne confond pas une durée quelconque avec une exigence d'expérience", () => {
    expect(requiredYearsFromDescription("Publiée il y a 9 jours. Bac+5 exigé.")).toBeNull();
    expect(requiredYearsFromDescription("Notre groupe existe depuis plus de 50 ans")).toBeNull();
    expect(requiredYearsFromDescription("Contrat de 2 ans, renouvelable")).toBeNull();
  });

  it("une annonce ouverte aux débutants ne demande pas plus de deux ans", () => {
    expect(requiredYearsFromDescription("Débutant accepté, formation assurée")).toBe(0);
    expect(requiredYearsFromDescription("3 ans d'expérience idéalement, jeune diplômé bienvenu")).toBe(2);
  });
});

describe("niveau implicite du titre", () => {
  it("reconnaît les niveaux, y compris en anglais", () => {
    expect(titleLevel("Senior Data Engineer").min).toBe(5);
    expect(titleLevel("Tech Lead .NET (H/F)").min).toBe(6);
    expect(titleLevel("Head of Finance - Start Up").min).toBe(8);
    expect(titleLevel("Business Analyst Assurance").min).toBeNull();
    expect(titleLevel("Stage Chargé(e) de Recrutement").junior).toBe(true);
  });
});

function profile(experiences: ProfileFull["experiences"]): ProfileFull {
  return {
    sectors: [], target_titles: [], target_countries: [], search_area: "", sources_enabled: [], preferred_contracts: ["cdi"],
    extraction_confidence: 0, experiences, educations: [], skills: [], languages: [],
  };
}

describe("expérience du profil", () => {
  const now = new Date(2026, 9, 11);

  it("compte une seule fois les périodes qui se chevauchent, un stage pour moitié", () => {
    const p = profile([
      { title: "Développeur", start_date: "2022-01", end_date: "2024-01", bullet_points: [], skills_used: [] },
      { title: "Développeur freelance", start_date: "2023-01", end_date: "2024-01", bullet_points: [], skills_used: [] },
      { title: "Stagiaire développeur", start_date: "2021-01", end_date: "2021-07", bullet_points: [], skills_used: [] },
    ]);
    expect(profileExperienceYears(p, now)).toBe(2.3);
  });

  it("lit « present » et renvoie null sans aucune date", () => {
    expect(profileExperienceYears(profile([
      { title: "Analyste", start_date: "2024-10", end_date: "present", bullet_points: [], skills_used: [] },
    ]), now)).toBe(2);
    expect(profileExperienceYears(profile([
      { title: "Analyste", start_date: null, end_date: null, bullet_points: [], skills_used: [] },
    ]), now)).toBeNull();
  });
});

describe("filtre d'expérience", () => {
  it("des années demandées bien au-dessus du profil font reculer l'offre, sans l'écarter (ancien banc : 81 % → 88 %)", () => {
    const fromAd = assessSeniority(2, "Business Analyst", "Vous justifiez d'une expérience de 7 ans minimum.");
    expect(fromAd.excluded).toBeNull();
    expect(fromAd.factor).toBeLessThan(0.6);
    expect(fromAd.note).toMatch(/7 ans/);

    // Le titre seul est un indice trop flou : il pénalise, il n'écarte pas.
    const fromTitle = assessSeniority(1, "Head of Data", "Rejoignez une équipe passionnée.");
    expect(fromTitle.excluded).toBeNull();
    expect(fromTitle.factor).toBeLessThan(1);
  });

  it("ne filtre rien quand l'expérience du profil est inconnue", () => {
    expect(assessSeniority(null, "Senior Engineer", "10 ans d'expérience").excluded).toBeNull();
  });
});

describe("découpage du texte", () => {
  it("distingue « Tech Lead » de « Tech. de maintenance »", () => {
    expect(tokenize("Tech Lead Java (H/F)")).toEqual(["techlead", "java"]);
    expect(tokenize("Tech. de Maintenance (h/f)")).toEqual(["tech", "maintenance"]);
  });

  it("garde .NET, C# et les formes inclusives", () => {
    expect(tokenize("Tech Lead.NET – F/H")).toEqual(["techlead", "dotnet"]);
    expect(tokenize("Développeur(se) C# confirmé(e)")).toEqual(["developpeur", "csharp", "confirme"]);
  });

  it("ramène le français et l'anglais à la même forme", () => {
    expect(tokenize("Business Developer")).toEqual(tokenize("développeur commercial"));
    expect(tokenize("Data Engineer")).toEqual(tokenize("Ingénieur données"));
    expect(tokenize("Start-up")).toEqual(tokenize("startups"));
  });
});
