import { describe, expect, it } from "vitest";
import { assessLanguage, detectLanguage, profileLanguages, requiredLanguages } from "@/lib/scoring/language";
import type { ProfileFull } from "@/lib/cv/types";

function profile(languages: ProfileFull["languages"], summary = ""): ProfileFull {
  return {
    summary, sectors: [], target_titles: [], target_countries: [], search_area: "", sources_enabled: [], preferred_contracts: ["cdi"],
    extraction_confidence: 0, experiences: [], educations: [], skills: [], languages,
  };
}

const FR_EN_ES_B1 = profile([
  { name: "French", level: "Native" },
  { name: "English", level: "C1" },
  { name: "Spanish", level: "B1, Intermediate" },
]);

const GERMAN_AD =
  "Als Tech Partner für Analytics verbindest du Business und IT. Du bist die Ansprechperson für die Fachbereiche und " +
  "sorgst mit deinem Team dafür, dass unsere Daten sicher sind. Erfahrung mit Power BI und sehr gute Kenntnisse sowie Freude an der Arbeit.";
const DUTCH_AD =
  "Deze vacature is niet beschikbaar in je land. Voor onze klant zoeken wij een landmeter met ervaring. Jij bent " +
  "verantwoordelijk voor het opmeten van nutsleidingen met GPS en je werkt ook bij de klant. Wat bieden wij een goed salaris.";
const ENGLISH_AD =
  "We are looking for a Sales Development Representative to join our team. You will prospect new accounts and " +
  "work with the account executives. What we offer: a great team and the skills you need to grow with our company.";

describe("langue de rédaction", () => {
  it("reconnaît l'allemand, le néerlandais et l'anglais", () => {
    expect(detectLanguage(GERMAN_AD).lang).toBe("de");
    expect(detectLanguage(DUTCH_AD).lang).toBe("nl");
    expect(detectLanguage(ENGLISH_AD).lang).toBe("en");
  });

  it("ne tranche pas sur un texte trop court", () => {
    expect(detectLanguage("Technicien de maintenance H/F").lang).toBeNull();
  });
});

describe("langues exigées", () => {
  it("lit les exigences relevées dans de vraies annonces", () => {
    expect(requiredLanguages("Sales Development Representative - German Speaking", ENGLISH_AD)).toEqual(["de"]);
    expect(requiredLanguages("SME Solutions Consultant (Portuguese Language)", ENGLISH_AD)).toEqual(["pt"]);
    expect(requiredLanguages("Wolof Freelance Remote Interpreter", ENGLISH_AD)).toContain("wo");
    expect(requiredLanguages("Commercial", "Maîtrise de l'allemand exigée pour suivre nos clients.")).toEqual(["de"]);
    expect(requiredLanguages("Assistant", "Anglais courant indispensable.")).toEqual(["en"]);
    expect(requiredLanguages("Consultant", "Fluent Dutch is required for this role.")).toEqual(["nl"]);
    expect(requiredLanguages("Account manager", "Profil germanophone recherché.")).toEqual(["de"]);
  });

  it("ignore une langue présentée comme un atout", () => {
    expect(requiredLanguages("Commercial", "La maîtrise de l'allemand serait un plus.")).toEqual([]);
    expect(requiredLanguages("Analyst", "Fluent German is a plus.")).toEqual([]);
    expect(requiredLanguages("Analyst", "Atouts : néerlandais courant, permis B.")).toEqual([]);
  });
});

describe("langues du profil", () => {
  it("distingue niveau maîtrisé et niveau partiel", () => {
    const spoken = profileLanguages(FR_EN_ES_B1)!;
    expect(spoken.get("fr")).toBe("mastered");
    expect(spoken.get("en")).toBe("mastered");
    expect(spoken.get("es")).toBe("partial");
  });

  it("compte la langue du CV même si la liste l'omet", () => {
    const p = profile(
      [{ name: "Anglais", level: "B2" }],
      "Technicien de maintenance avec une solide expérience des installations industrielles, des automatismes et de la " +
        "maintenance préventive pour les clients de la région, dans une équipe qui assure les interventions sur site."
    );
    expect(profileLanguages(p)!.get("fr")).toBe("mastered");
  });

  it("ne filtre rien quand le profil ne liste aucune langue", () => {
    expect(profileLanguages(profile([]))).toBeNull();
    expect(assessLanguage(null, "Senior Engineer", GERMAN_AD).excluded).toBeNull();
  });
});

describe("filtre de langue", () => {
  const spoken = profileLanguages(FR_EN_ES_B1);

  it("écarte une annonce rédigée dans une langue absente du profil", () => {
    expect(assessLanguage(spoken, "Tech Partner Analytics", GERMAN_AD).excluded).toMatch(/allemand/);
    expect(assessLanguage(spoken, "Landmeter", DUTCH_AD).excluded).toMatch(/néerlandais/);
  });

  it("écarte une annonce qui exige une langue absente du profil, même rédigée en anglais", () => {
    expect(assessLanguage(spoken, "Sales Development Representative - German Speaking", ENGLISH_AD).excluded).toMatch(/allemand/);
  });

  it("pénalise sans écarter une langue parlée à un niveau partiel", () => {
    const r = assessLanguage(spoken, "Customer support", `${ENGLISH_AD} Fluent Spanish is required.`);
    expect(r.excluded).toBeNull();
    expect(r.factor).toBeLessThan(1);
  });

  it("laisse passer une annonce bilingue dont l'une des langues est parlée", () => {
    const bilingual = `${GERMAN_AD} ${ENGLISH_AD} ${ENGLISH_AD}`;
    expect(assessLanguage(spoken, "Data Analyst", bilingual).excluded).toBeNull();
  });
});
