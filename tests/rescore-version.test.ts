import { describe, expect, it } from "vitest";
import { getDb, getSetting } from "@/lib/db";
import { saveProfile } from "@/lib/db/queries";
import { upsertOffreFromSource, setOffreScore } from "@/lib/db/offres";
import { ensureScoresCurrent, SCORING_VERSION } from "@/lib/scoring/rescore";
import { profile } from "./fixtures";

/**
 * Une mise à jour de la note ne touchait les offres déjà en base qu'au prochain
 * scan : au démarrage (instrumentation.ts), elles sont recalculées une fois.
 */
describe("notes recalculées quand la note change", () => {
  it("recalcule une fois, puis ne refait rien tant que la version ne change pas", () => {
    getDb().exec("DELETE FROM offres; DELETE FROM settings WHERE key = 'scoring:version'");
    saveProfile(profile as never);
    const id = upsertOffreFromSource("hellowork", {
      source_id: "v-1", url: "https://example.org/v-1", title: "Cheffe de projet digital", company: "Agence",
      country: "France", location: "Lyon", contract_type: "CDI", salary: null, description_html: "<p>…</p>",
      description_text: "Pilotage de projets web pour des clients PME, en lien avec les équipes techniques.",
      description_status: "ok", posted_at: "2026-10-01", is_vie: false, raw_payload: {},
    });
    setOffreScore(id, { score: 3, breakdown: { sector: 0, skills: 0, country: 0 }, reason: "note d'une version précédente" });

    expect(ensureScoresCurrent()).toBe(true);
    const row = getDb().prepare("SELECT score FROM offres WHERE id = ?").get(id) as { score: number };
    expect(row.score).toBeGreaterThan(3);
    expect(getSetting("scoring:version")).toContain(SCORING_VERSION);
    expect(ensureScoresCurrent()).toBe(false);
  });
});
