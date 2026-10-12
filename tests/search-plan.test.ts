import { describe, expect, it } from "vitest";
import { DEPARTEMENTS, REGIONS, parseSearchArea, searchAreaLabel, searchAreaValue } from "@/lib/geo/fr";
import { MAX_QUERIES, buildSearchPlan, quotaPerQuery } from "@/lib/scan/search-plan";

const exp = (title: string) => ({ title, bullet_points: [], skills_used: [] });

describe("ce qu'un scan cherche", () => {
  it("les postes visés d'abord, dédoublonnés, au plus quatre", () => {
    const plan = buildSearchPlan({
      target_titles: ["Business Analyst", "business analyst", "Consultant AMOA", "PO", "Chef de projet", "Data Analyst"],
      experiences: [exp("Vendeur")],
      sectors: ["tech"],
      search_area: "",
    });
    expect(plan.queries).toEqual(["Business Analyst", "Consultant AMOA", "PO", "Chef de projet"]);
    expect(plan.queries).toHaveLength(MAX_QUERIES);
    expect(plan.origin).toBe("postes_vises");
  });

  it("sans poste visé : les expériences récentes, jamais un stage ni une alternance", () => {
    const plan = buildSearchPlan({
      target_titles: [],
      experiences: [exp("Stagiaire marketing"), exp("Sales Representative"), exp("Commercial en alternance"), exp("Vendeur")],
      sectors: ["tech"],
      search_area: "",
    });
    expect(plan.queries).toEqual(["Sales Representative", "Vendeur"]);
    expect(plan.origin).toBe("experiences");
  });

  it("en dernier recours, les secteurs", () => {
    expect(buildSearchPlan({ target_titles: [], experiences: [], sectors: ["tech", "services"], search_area: "" }).queries).toEqual(["tech", "services"]);
  });

  it("chaque requête a sa part du quota d'une source", () => {
    expect(quotaPerQuery(50, 3)).toBe(17);
    expect(quotaPerQuery(50, 1)).toBe(50);
    expect(quotaPerQuery(50, 0)).toBe(50);
  });
});

describe("zone de recherche", () => {
  it("lit région et département, ignore une valeur inconnue", () => {
    expect(parseSearchArea("D:69")).toEqual({ kind: "departement", code: "69", name: "Rhône" });
    expect(parseSearchArea("R:84")).toEqual({ kind: "region", code: "84", name: "Auvergne-Rhône-Alpes" });
    expect(parseSearchArea("D:2A")!.name).toBe("Corse-du-Sud");
    expect(parseSearchArea("D:99")).toBeNull();
    expect(parseSearchArea("")).toBeNull();
    expect(searchAreaLabel(parseSearchArea("D:974")!)).toBe("La Réunion (974)");
    expect(searchAreaValue(parseSearchArea("R:11")!)).toBe("R:11");
  });

  it("la liste embarquée est complète et cohérente", () => {
    expect(REGIONS).toHaveLength(18);
    expect(DEPARTEMENTS).toHaveLength(101);
    expect(new Set(DEPARTEMENTS.map((d) => d.code)).size).toBe(101);
    const regionCodes = new Set(REGIONS.map((r) => r.code));
    for (const d of DEPARTEMENTS) expect(regionCodes.has(d.region)).toBe(true);
    // Chaque région a au moins un département.
    for (const r of REGIONS) expect(DEPARTEMENTS.some((d) => d.region === r.code)).toBe(true);
  });
});
