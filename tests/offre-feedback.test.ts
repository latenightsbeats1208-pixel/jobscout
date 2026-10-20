import { describe, expect, it } from "vitest";
import { getDb } from "@/lib/db";
import { getFeedback, setFeedback } from "@/lib/db/feedback";
import { searchOffres, setOffreScore, suggestedOffres, upsertOffreFromSource, type ScrapedOffre } from "@/lib/db/offres";
import { computeFeedbackStats, pairwiseAgreement } from "@/lib/scoring/feedback-stats";

/**
 * Avis 👍 / 👎 : enregistrement, effet sur la liste et les suggestions, et
 * mesure de l'accord entre la note et les avis. Base SQLite temporaire.
 */

let seq = 0;
function add(score: number): number {
  seq++;
  const o: ScrapedOffre = {
    source_id: `fb-${seq}`, url: `https://example.org/fb/${seq}`, title: `Poste ${seq}`, company: "Exemple",
    country: "France", location: "Lyon", contract_type: "CDI", salary: null, description_html: "<p>x</p>",
    description_text: "Description du poste.", description_status: "ok", posted_at: "2026-01-15", is_vie: false, raw_payload: {},
  };
  const id = upsertOffreFromSource("hellowork", o);
  setOffreScore(id, { score, breakdown: { sector: 0, skills: 0, country: 0 }, reason: "" });
  return id;
}

describe("avis sur une offre", () => {
  it("s'enregistre, se remplace et se retire", () => {
    const id = add(50);
    expect(getFeedback(id)).toBeNull();
    setFeedback(id, { verdict: "down", reason: "metier" });
    expect(getFeedback(id)).toEqual({ verdict: "down", reason: "metier" });
    setFeedback(id, { verdict: "up", reason: null });
    expect(getFeedback(id)).toEqual({ verdict: "up", reason: null });
    const row = getDb().prepare("SELECT score_at FROM offre_feedback WHERE offre_id = ?").get(id) as { score_at: number };
    expect(row.score_at).toBe(50); // la note affichée au moment de l'avis est gardée
    setFeedback(id, null);
    expect(getFeedback(id)).toBeNull();
  });

  it("un 👎 descend en fin de liste, quel que soit le tri, et n'est plus suggéré", () => {
    getDb().exec("DELETE FROM offre_feedback; DELETE FROM offres;");
    const best = add(95);
    const mid = add(70);
    const low = add(40);
    setFeedback(best, { verdict: "down", reason: null });

    const smart = searchOffres().offers.map((o) => o.id);
    expect(smart).toEqual([mid, low, best]);
    expect(searchOffres({ sortBy: "score" }).offers.map((o) => o.id)).toEqual([mid, low, best]);
    expect(searchOffres().offers.find((o) => o.id === best)!.feedback).toEqual({ verdict: "down", reason: null });
    expect(suggestedOffres(6).map((o) => o.id)).not.toContain(best);
  });
});

describe("accord entre la note et les avis", () => {
  it("compte les paires bien rangées, les égalités pour moitié", () => {
    expect(pairwiseAgreement([90, 80, 70, 60, 50], [40, 30, 20, 10, 0])).toBe(1);
    expect(pairwiseAgreement([50, 50, 50, 50, 50], [50, 50, 50, 50, 50])).toBe(0.5);
    expect(pairwiseAgreement([0, 10, 20, 30, 40], [50, 60, 70, 80, 90])).toBe(0);
  });

  it("ne mesure rien avec moins de cinq avis de chaque sorte", () => {
    expect(pairwiseAgreement([90, 80], [10, 20, 30, 40, 50])).toBeNull();
  });

  it("compte une candidature sans avis comme un 👍, et regroupe les motifs des 👎", () => {
    getDb().exec("DELETE FROM offre_feedback; DELETE FROM candidatures; DELETE FROM offres;");
    const ups = [90, 85, 80, 75].map(add);
    const applied = add(70);
    const downs = [60, 55, 50, 45, 82].map(add);
    ups.forEach((id) => setFeedback(id, { verdict: "up", reason: null }));
    getDb().prepare("INSERT INTO candidatures (offre_id) VALUES (?)").run(applied);
    downs.forEach((id, i) => setFeedback(id, { verdict: "down", reason: i < 3 ? "metier" : "lieu" }));

    const stats = computeFeedbackStats();
    expect(stats.up).toBe(4);
    expect(stats.implicitUp).toBe(1);
    expect(stats.down).toBe(5);
    // Un seul 👎 (82) passe devant trois 👍 (80, 75, 70) : 3 paires perdues sur 25.
    expect(stats.agreement).toBeCloseTo(22 / 25);
    expect(stats.reasons).toEqual([{ id: "metier", count: 3 }, { id: "lieu", count: 2 }]);
  });
});
