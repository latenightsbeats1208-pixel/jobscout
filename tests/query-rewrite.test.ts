import { describe, expect, it } from "vitest";
import { frenchTitle, rewriteTitle, withoutGenderForms } from "@/lib/scan/query-rewrite";
import { buildSearchPlan } from "@/lib/scan/search-plan";

const exp = (title: string) => ({ title, bullet_points: [], skills_used: [] });

describe("un intitulé de CV devient une requête", () => {
  // Les intitulés des 8 CV de l'audit d'octobre 2026, et ce qu'ils trouvaient sur France Travail.
  it("retire le féminin d'un grade, le diplôme et la spécialité accolée", () => {
    expect(rewriteTitle("Conductrice de travaux principale")).toEqual(["Conducteur de travaux"]); // 45 → 7 351 offres
    expect(rewriteTitle("Masseur-Kinésithérapeute Diplômée d'État")).toEqual(["Masseur-Kinésithérapeute"]); // 8 → 2 228
    expect(rewriteTitle("Développeur back-end PHP / Symfony")).toEqual(["Développeur PHP"]); // 0 → 24 dans le Finistère
    expect(rewriteTitle("Chargée de marketing digital & social media")).toEqual(["Chargé de marketing digital"]);
    expect(rewriteTitle("Infirmière DE")).toEqual(["Infirmier"]);
  });

  it("efface les marques de genre sous toutes leurs formes", () => {
    expect(rewriteTitle("Technicienne de maintenance (H/F)")).toEqual(["Technicien de maintenance"]);
    expect(rewriteTitle("Chargé(e) de recrutement")).toEqual(["Chargé de recrutement"]);
    expect(rewriteTitle("Conducteur·rice de travaux")).toEqual(["Conducteur de travaux"]);
    expect(rewriteTitle("Conseillère clientèle")).toEqual(["Conseiller clientèle"]);
    expect(rewriteTitle("Assistante sociale")).toEqual(["Assistant social"]);
    expect(rewriteTitle("Aide-soignante")).toEqual(["Aide-soignant"]);
  });

  it("ne touche pas ce qui n'est pas une marque de genre", () => {
    // Seul le premier mot porte le métier : « filière » n'est pas un féminin.
    expect(rewriteTitle("Responsable filière bois")).toEqual(["Responsable filière bois"]);
    expect(rewriteTitle("Ingénieur R&D")).toEqual(["Ingénieur R&D"]);
    expect(rewriteTitle("Agent de sécurité incendie SSIAP 1")).toEqual(["Agent de sécurité incendie SSIAP 1"]);
    // Sans autre précision, la spécialité reste : « Développeur » seul serait trop large.
    expect(rewriteTitle("Développeur.se full stack")).toEqual(["Développeur full stack"]);
    // Les annonces titrent ce métier au féminin (3 382 offres contre 1 508).
    expect(rewriteTitle("Puéricultrice")).toEqual(["Puéricultrice"]);
    // Un intitulé anglais garde ses mots.
    expect(rewriteTitle("Employee Relations Manager")).toEqual(["Employee Relations Manager"]);
  });

  it("garde « Junior », en plus de l'intitulé sans grade : c'est la requête qui trouve les postes d'un débutant", () => {
    // 19 octobre 2026 : « Acheteur Junior » devenait « Acheteur », et aucune offre « Acheteur Junior » n'était collectée.
    expect(rewriteTitle("Acheteur Junior")).toEqual(["Acheteur Junior", "Acheteur"]);
    expect(rewriteTitle("Chargée de marketing junior")).toEqual(["Chargé de marketing junior", "Chargé de marketing"]);
    // Les autres grades restent retirés.
    expect(rewriteTitle("Acheteur Senior")).toEqual(["Acheteur"]);
    expect(buildSearchPlan({ target_titles: ["Acheteur Junior", "Acheteur"], experiences: [], sectors: [], search_area: "R:11" }).queries).toEqual([
      "Acheteur Junior",
      "Acheteur",
    ]);
  });

  it("garde la partie droite d'une barre oblique quand c'est un poste", () => {
    expect(rewriteTitle("Comptable / Assistante de gestion")).toEqual(["Comptable", "Assistant de gestion"]);
  });
});

describe("un intitulé anglais reçoit sa traduction", () => {
  it("traduit les métiers courants, dans l'ordre français", () => {
    expect(frenchTitle("Mechanical Design Engineer")).toBe("Ingénieur conception mécanique");
    expect(frenchTitle("Design Engineer")).toBe("Ingénieur conception");
    expect(frenchTitle("Senior Java Developer")).toBe("Développeur Java");
    expect(frenchTitle("Full Stack Developer")).toBe("Développeur full stack");
    expect(frenchTitle("Project Manager")).toBe("Chef de projet");
  });

  it("préfère ne rien traduire plutôt que mal traduire", () => {
    expect(frenchTitle("Customer Success Manager")).toBeNull();
    expect(frenchTitle("Head of Logistics Operations")).toBeNull();
    expect(frenchTitle("Data Scientist")).toBeNull();
    expect(frenchTitle("Chef de projet")).toBeNull();
    expect(frenchTitle("Ingénieur pédagogique")).toBeNull();
  });

  it("n'ajoute la traduction que si la France fait partie des pays visés", () => {
    const profile = { target_titles: ["Mechanical Design Engineer"], experiences: [], sectors: [], search_area: "" };
    expect(buildSearchPlan({ ...profile, target_countries: ["France", "Espagne"] }).queries).toEqual([
      "Mechanical Design Engineer",
      "Ingénieur conception mécanique",
    ]);
    expect(buildSearchPlan({ ...profile, target_countries: ["Espagne"] }).queries).toEqual(["Mechanical Design Engineer"]);
  });

  it("deux intitulés qui se réécrivent pareil ne coûtent qu'une requête", () => {
    const plan = buildSearchPlan({
      target_titles: ["Chargée de marketing digital & social media", "Chargée de marketing digital"],
      experiences: [exp("Alternante chargée de communication")],
      sectors: [],
      search_area: "D:33",
    });
    expect(plan.queries).toEqual(["Chargé de marketing digital"]);
  });
});

describe("un intitulé d'annonce perd ses doublets de genre avant la note", () => {
  it("fusionne « Masseur / Masseuse », garde deux métiers distincts", () => {
    // « Masseuse », mot rare sans correspondance, faisait tomber la proximité de titre de 48 à 17.
    expect(withoutGenderForms("Masseur / Masseuse kinésithérapeute (H/F)")).toBe("Masseur kinésithérapeute");
    expect(withoutGenderForms("Conducteur / Conductrice de travaux")).toBe("Conducteur de travaux");
    expect(withoutGenderForms("Agent / Agente de sécurité incendie")).toBe("Agent de sécurité incendie");
    expect(withoutGenderForms("Développeur/Développeuse web")).toBe("Développeur web");
    expect(withoutGenderForms("Comptable / Assistante de gestion")).toBe("Comptable / Assistante de gestion");
    expect(withoutGenderForms("Développeur PHP / Symfony")).toBe("Développeur PHP / Symfony");
  });
});
