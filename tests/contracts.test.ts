import { describe, expect, it } from "vitest";
import { classifyContract } from "@/lib/contracts";

const AGENCE = "Le Groupe TEAM EMPLOI, acteur dynamique du travail temporaire et du recrutement en CDD et CDI, vous ouvre les portes de l'emploi.";
const classify = (contract_type: string | null, description = "", title = "Cariste H/F") =>
  classifyContract({ contract_type, title, description_text: description });

describe("catégorie de contrat", () => {
  it("l'intérim est une catégorie à part, quel que soit le libellé de la source", () => {
    expect(classify("Intérim", AGENCE)).toBe("interim"); // HelloWork, carte France Travail
    expect(classify("Intérim - 18 Mois", AGENCE)).toBe("interim"); // JSON France Travail
    expect(classify("Mission intérimaire")).toBe("interim");
    expect(classify("CDI intérimaire")).toBe("cdi");
    expect(classify("Saisonnier - 4 Mois")).toBe("cdd");
  });

  it("le contrat déclaré l'emporte sur les contrats que cite la description", () => {
    expect(classify("CDI", AGENCE)).toBe("cdi");
    expect(classify("CDI", "Vous encadrerez deux alternants et un stagiaire.")).toBe("cdi");
    expect(classify("CDD - 24 Mois - Contrat apprentissage")).toBe("alternance");
    expect(classify("CDD", "Contrat en alternance de 24 mois, rythme 3 semaines / 1 semaine.")).toBe("alternance");
    expect(classify("CDD", "", "Préparateur de commandes en alternance (H/F)")).toBe("alternance");
  });

  it("« STG » dans le titre est un stage ; le bac STG d'une description, non (cas réel : Printemps)", () => {
    expect(classify(null, "Le Printemps est un leader du commerce.", "STG - Assistant(e) Acheteur/Chef de produit PAP Homme (H/F)")).toBe("stage");
    expect(classify(null, "Titulaire d'un bac STG, vous rejoignez notre équipe en CDI.", "Assistant commercial (H/F)")).toBe("cdi");
  });

  it("sans contrat déclaré : la formule d'agence ne tranche rien, une mission si", () => {
    expect(classify(null, AGENCE)).toBe("autre");
    expect(classify(null, `${AGENCE} Mission d'intérim de longue durée à Poupry.`)).toBe("interim");
    expect(classify(null, "Poste en CDI, temps plein.")).toBe("cdi");
    expect(classify("FULL_TIME", AGENCE)).toBe("cdi");
  });
});
