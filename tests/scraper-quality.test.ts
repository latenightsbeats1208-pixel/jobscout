import { describe, expect, it } from "vitest";
import { assessQuality, describesTitle, summarizeIssues, type QualityInput } from "@/lib/scrapers/quality";

const long = (text: string) => `${text} ${"Vous rejoignez une équipe engagée au service de nos clients. ".repeat(8)}`;

function offer(over: Partial<QualityInput>): QualityInput {
  return {
    title: "Comptable général H/F",
    company: "Exemple SA",
    location: "Lyon",
    posted_at: "2026-10-01",
    description_text: long("Vous tenez la comptabilité générale et préparez les clôtures."),
    description_html: "<p>…</p>",
    description_status: "ok",
    ...over,
  };
}

describe("contrôle de qualité d'une offre", () => {
  it("laisse passer une annonce saine", () => {
    const q = assessQuality(offer({}));
    expect(q.status).toBe("ok");
    expect(q.issues).toEqual([]);
  });

  it("repère une description d'un autre poste (cas réel France Travail)", () => {
    const q = assessQuality(
      offer({
        title: "Tech Lead .Net (H/F)",
        location: "Villeurbanne",
        description_text: long("Développeur Sénior - Java / VueJS (H/F) ALTECA - 69 - VILLEURBANNE. Chez Alteca le management est de proximité."),
      })
    );
    expect(q.status).toBe("failed");
    expect(q.issues).toContain("description_sans_rapport");
  });

  it("repère le texte d'une page de résultats", () => {
    const q = assessQuality(
      offer({ description_text: long("La liste des offres d'emploi est restituée par ordre de pertinence. Cela veut dire que les offres…") })
    );
    expect(q.status).toBe("failed");
    expect(q.issues).toContain("page_de_resultats");
  });

  it("retire les textes de blocage géographique, en plusieurs langues", () => {
    for (const parasite of [
      "Cette offre d'emploi n'est pas disponible dans votre pays.",
      "Deze vacature is niet beschikbaar in je land.",
      "Diese Stelle ist in deinem Land nicht verfügbar.",
    ]) {
      const q = assessQuality(offer({ description_text: `${parasite} ${long("Comptable général : tenue des comptes.")}`, description_html: `<p>${parasite}</p><p>Comptable</p>` }));
      expect(q.issues).toContain("texte_parasite");
      expect(q.description_text.startsWith("Comptable")).toBe(true);
      expect(q.description_html).not.toContain(parasite);
    }
  });

  it("un extrait court rend l'offre partielle, sans jamais relever un statut", () => {
    expect(assessQuality(offer({ description_text: "Comptable général, tenue des comptes." })).status).toBe("partial");
    expect(assessQuality(offer({ description_status: "failed" })).status).toBe("failed");
  });

  it("relève les champs manquants sans changer le statut", () => {
    const q = assessQuality(offer({ posted_at: null, location: "", company: null }));
    expect(q.issues).toEqual(["sans_date", "sans_lieu", "sans_entreprise"]);
    expect(q.status).toBe("ok");
  });
});

describe("la description parle-t-elle du poste ?", () => {
  it("se contente d'un mot porteur, au radical près et du français à l'anglais", () => {
    expect(describesTitle("Comptable général", "Tenue de la comptabilité générale", null)).toBe(true);
    expect(describesTitle("Software Engineer", "Ingénieur logiciel au sein de l'équipe produit", null)).toBe(true);
  });

  it("ne conclut pas sur une preuve trop mince (cas réels)", () => {
    // « Tech Agent » chez Renault : un poste de technicien d'atelier, sans le mot « agent ».
    expect(describesTitle("Tech Agent H/F", "Interventions de maintenance préventive sur véhicules", null)).toBe(true);
    // « Tech Lead » : l'annonce parle d'encadrer les équipes techniques, sans écrire « tech lead ».
    expect(describesTitle("Tech Lead", "Coacher les équipes techniques et superviser les projets", null)).toBe(true);
  });

  it("ignore la ville du titre", () => {
    // La ville du titre ne suffit pas à rattacher une description au poste.
    expect(describesTitle("Comptable fournisseurs - Rouen", "Rouen, Normandie : agence de communication événementielle", "Rouen")).toBe(false);
  });
});

describe("résumé pour le journal du scan", () => {
  it("compte chaque problème, du plus grave au moins grave", () => {
    expect(summarizeIssues({ sans_date: 50, description_sans_rapport: 15 })).toBe(
      "15 × description qui ne parle pas du poste du titre · 50 × sans date"
    );
    expect(summarizeIssues({})).toBeNull();
  });
});

describe("le métier et son activité ne partagent pas toujours leur radical", () => {
  // Recherche « Acheteur » du 19 octobre 2026 : 13 annonces sur 223 perdaient leur description.
  it("une annonce d'acheteur qui parle d'achats, en anglais ou de marchés publics décrit bien le poste", () => {
    expect(describesTitle("Acheteur confirmé F/H", long("Rattaché au responsable, vous pilotez une ou plusieurs catégories d'achats directs et indirects."), "Créteil")).toBe(true);
    expect(describesTitle("Acheteur H/F", long("As a Buyer in our procurement team, you negotiate with suppliers worldwide."), "Paris")).toBe(true);
    expect(describesTitle("Acheteur H/F", long("Élaboration des procédures de marchés publics : appels d'offres, négociation, MAPA."), null)).toBe(true);
  });

  it("une description d'un autre poste reste écartée", () => {
    expect(describesTitle("Acheteur H/F", long("Vous préparez les commandes des clients en entrepôt et chargez les camions chaque matin."), null)).toBe(false);
  });
});
