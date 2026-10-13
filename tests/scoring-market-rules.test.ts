import { describe, expect, it } from "vitest";
import { locateFr, zoneFit } from "@/lib/geo/locate";
import { parseSearchArea } from "@/lib/geo/fr";
import { decodeHtmlEntities } from "@/lib/text/entities";
import { htmlToText } from "@/lib/scrapers/base";
import { assessLanguage, requiredLanguages } from "@/lib/scoring/language";
import { scoreOffreLocal } from "@/lib/scoring/local";
import type { ProfileFull } from "@/lib/cv/types";

/**
 * Règles tirées du banc « marché » (12 profils réels, octobre 2026) : la zone
 * de recherche, le contrat, les entités HTML et la langue des exigences.
 */

describe("situer une offre", () => {
  it("lit les formes de lieu des sources", () => {
    expect(locateFr("Lyon")?.dept).toBe("69");
    expect(locateFr("LYON 01")?.dept).toBe("69");
    expect(locateFr("Lyon 8e Arrondissement")?.dept).toBe("69");
    expect(locateFr("Paris 15e")?.dept).toBe("75");
    expect(locateFr("STE FOY LES LYON")?.dept).toBe("69");
    expect(locateFr("Lyon et périphérie")?.dept).toBe("69");
    expect(locateFr("Le Grand-Quevilly (76)")?.dept).toBe("76");
    expect(locateFr("76")?.dept).toBe("76");
    expect(locateFr("Hauts-de-France")).toMatchObject({ dept: null, region: "32" });
    expect(locateFr("Paris, Île-de-France, France")?.dept).toBe("75");
    expect(locateFr("Région métropolitaine de Kansas City")).toBeNull();
  });

  it("dans la zone, près d'elle, ou hors zone ; rien de pénalisé sans lieu connu", () => {
    const offer = (location: string, country = "France", description = "") => ({ location, country, title: "Infirmier", description_text: description });
    const lyon = parseSearchArea("D:69");
    expect(zoneFit(lyon, offer("Vénissieux")).fit).toBe("dans");
    expect(zoneFit(lyon, offer("Saint-Etienne")).fit).toBe("proche");
    expect(zoneFit(lyon, offer("Cherbourg-en-Cotentin")).fit).toBe("hors");
    expect(zoneFit(lyon, offer("Hameau inconnu")).fit).toBeNull();
    expect(zoneFit(lyon, offer("Genève", "Suisse")).fit).toBeNull();
    expect(zoneFit(lyon, offer("Paris", "France", "Poste en télétravail complet, partout en France.")).fit).toBeNull();
    expect(zoneFit(null, offer("Paris")).fit).toBeNull();
    expect(zoneFit(parseSearchArea("R:11"), offer("Saint-Denis")).fit).toBe("dans"); // homonyme 93 / 974
  });
});

describe("texte des annonces", () => {
  it("décode toutes les entités, même doublement encodées (cas réel Welcome to the Jungle)", () => {
    expect(decodeHtmlEntities("au moins 6&#xa0;ans d'exp&eacute;rience, Bac &#43;5")).toBe("au moins 6 ans d'expérience, Bac +5");
    expect(decodeHtmlEntities("6&amp;#xa0;ans")).toBe("6 ans");
    expect(htmlToText("<p>4&amp;#xa0;ans d&rsquo;exp&eacute;rience</p>")).toBe("4 ans d’expérience");
  });
});

describe("langue de travail", () => {
  const englishOnly = new Map([["en", "mastered" as const]]);
  it("juge la langue sur le « profil recherché », pas sur la présentation du groupe (cas réel)", () => {
    const intro = "Essity is a leading global hygiene and health company. We innovate for good and we break barriers for the people we serve every day around the world. ".repeat(3);
    const profil = "Qui êtes-vous ? Vous avez impérativement occupé une fonction d'account manager, vous avez une excellente connaissance de la grande distribution et vous êtes à l'aise avec les chiffres et les négociations annuelles avec les enseignes.";
    expect(assessLanguage(englishOnly, "Account Manager", `${intro} ${profil}`).excluded).toMatch(/profil recherché rédigé en français/);
  });

  it("« bilingue anglais » dans une annonce française exige aussi le français", () => {
    expect(requiredLanguages("Customer Success Manager", "Poste basé à Paris, bilingue anglais exigé.")).toEqual(expect.arrayContaining(["fr", "en"]));
  });
});

describe("contrat et lieu dans la note", () => {
  const profile = {
    full_name: null, email: null, phone: null, location: null, linkedin_url: null, portfolio_url: null, summary: null, raw_cv_text: null,
    sectors: [], target_titles: ["UX Designer"], target_countries: ["France"], search_area: "D:13", sources_enabled: [],
    preferred_contracts: ["cdi", "cdd"], extraction_confidence: 90,
    experiences: [{ title: "UX Designer", company: "Agence", start_date: "2022-01", end_date: "present", bullet_points: [], skills_used: ["Figma"] }],
    educations: [], skills: [{ name: "Figma", evidence_experience_ids: [] }], languages: [{ name: "Français", level: "Natif" }],
  } as unknown as ProfileFull;
  const offer = (over: object) => ({ title: "UX Designer H/F", company: "Exemple", country: "France", location: "Marseille", contract_type: "CDI", description_text: "Vous concevez des maquettes Figma et menez des tests utilisateurs.", ...over });

  it("un stage écrit dans le contrat ou le titre est hors critères pour qui ne le cherche pas", () => {
    expect(scoreOffreLocal(profile, offer({ title: "Stage - UX Designer", contract_type: "Stage" })).breakdown.excluded).toMatch(/stage/);
    // Le mot « stage » dans la seule description ne suffit pas.
    expect(scoreOffreLocal(profile, offer({ description_text: "CDI. Possibilité d'encadrer un stagiaire. Maquettes Figma." })).breakdown.excluded).toBeUndefined();
  });

  it("hors zone : visible mais derrière la même offre dans la zone ; freelance en retrait", () => {
    const here = scoreOffreLocal(profile, offer({})).score;
    const far = scoreOffreLocal(profile, offer({ location: "Lille" }));
    expect(far.breakdown.location).toBe(20);
    expect(far.score).toBeLessThan(here * 0.7);
    expect(far.reason).toMatch(/hors de votre zone \(Lille\)/);
    expect(scoreOffreLocal(profile, offer({ contract_type: "Freelance" })).score).toBeLessThan(here);
  });
});
