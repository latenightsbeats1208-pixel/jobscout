import { beforeEach, describe, expect, it } from "vitest";
import { getDb } from "@/lib/db";
import { createCandidature, candidaturesCounts, upcomingDeadlines, searchReport } from "@/lib/db/candidatures";

beforeEach(() => {
  getDb().exec("DELETE FROM candidatures");
});

describe("rappels de candidature et bilan", () => {
  it("enregistre une date de relance, compte et expose les tâches proches, y compris les relances en retard", () => {
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    const upcomingFollowUp = createCandidature({ offre_id: null, follow_up_date: tomorrow });
    const overdueFollowUp = createCandidature({ offre_id: null, follow_up_date: yesterday });
    createCandidature({ offre_id: null, deadline: tomorrow });
    createCandidature({ offre_id: null, status: "refusee", follow_up_date: tomorrow });

    expect(candidaturesCounts().upcoming).toBe(2);
    const items = upcomingDeadlines(10);
    expect(items.map((item) => [item.id, item.kind])).toContainEqual([upcomingFollowUp, "follow_up"]);
    expect(items.map((item) => [item.id, item.kind])).toContainEqual([overdueFollowUp, "follow_up"]);
    expect(items.some((item) => item.status === "refusee")).toBe(false);
  });

  it("calcule les indicateurs sur les 30 jours et sur tout l'historique", () => {
    createCandidature({ offre_id: null, status: "envoyee" });
    createCandidature({ offre_id: null, status: "entretien" });
    createCandidature({ offre_id: null, status: "acceptee" });
    createCandidature({ offre_id: null, status: "refusee", applied_at: "2020-01-01" });
    expect(searchReport(30)).toMatchObject({
      total: 3,
      interviews: 1,
      responses: 2,
      accepted: 1,
      refused: 0,
      responseRate: 67,
    });
    expect(searchReport(0)).toMatchObject({ total: 4, refused: 1 });
  });
});
