import { describe, expect, it } from "vitest";
import { getDb } from "@/lib/db";
import { upsertOffreFromSource } from "@/lib/db/offres";
import { recheckStoredQuality } from "@/lib/scrapers/quality-store";

describe("contrôle de qualité des offres déjà en base", () => {
  it("nettoie une fois, puis ne modifie plus rien, et garde la trace du nettoyage", () => {
    const description = `Cette offre d'emploi n'est pas disponible dans votre pays. Comptable général : ${"tenue des comptes et clôtures mensuelles. ".repeat(12)}`;
    const id = upsertOffreFromSource("talent", {
      source_id: "q-1", url: "https://example.org/q-1", title: "Comptable général", company: "Exemple", country: "France",
      location: "Lyon", contract_type: "CDI", salary: null, description_html: `<p>${description}</p>`, description_text: description,
      description_status: "ok", posted_at: "2026-10-01", is_vie: false, raw_payload: {},
    });
    expect(recheckStoredQuality().changed).toBe(1);
    expect(recheckStoredQuality().changed).toBe(0);
    const row = getDb().prepare("SELECT description_text, quality_issues FROM offres WHERE id = ?").get(id) as { description_text: string; quality_issues: string };
    expect(row.description_text.startsWith("Comptable général")).toBe(true);
    expect(JSON.parse(row.quality_issues)).toContain("texte_parasite");
  });
});
