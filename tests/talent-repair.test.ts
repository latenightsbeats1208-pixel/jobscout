import { describe, expect, it } from "vitest";
import { getDb } from "@/lib/db";
import { repairLegacyTalentRows } from "@/lib/db";

describe("réparation des offres Talent.com de l'ancien analyseur", () => {
  it("rend l'entreprise prise pour le contrat, une seule fois, sans toucher aux autres sources", () => {
    const db = getDb(); // la réparation a déjà tourné à l'ouverture, sur une base vide
    db.exec("DELETE FROM settings WHERE key = 'repair:talent-cards-2026-10'");
    const ins = db.prepare(
      "INSERT INTO offres (source, source_id, url, title, company, location, contract_type, description_html, description_text) VALUES (?, ?, 'u', 't', ?, ?, ?, '', '')"
    );
    ins.run("talent", "a", "", null, "newslot recrutement"); // entreprise manquante : récupérée
    ins.run("talent", "b", "Crit Lyon", null, "crit lyon"); // entreprise connue : contrat vidé
    ins.run("hellowork", "c", "Exemple", null, "CDI"); // autre source : intacte
    repairLegacyTalentRows(db);
    const rows = db.prepare("SELECT source_id, company, contract_type FROM offres ORDER BY source_id").all();
    expect(rows.map((r) => ({ ...r }))).toEqual([
      { source_id: "a", company: "newslot recrutement", contract_type: null },
      { source_id: "b", company: "Crit Lyon", contract_type: null },
      { source_id: "c", company: "Exemple", contract_type: "CDI" },
    ]);
    // Une seconde fois : plus rien, même sur une offre qui ressemblerait à l'ancien format.
    ins.run("talent", "d", "", null, "CDI");
    repairLegacyTalentRows(db);
    expect({ ...db.prepare("SELECT company, contract_type FROM offres WHERE source_id = 'd'").get() }).toEqual({ company: "", contract_type: "CDI" });
  });
});
