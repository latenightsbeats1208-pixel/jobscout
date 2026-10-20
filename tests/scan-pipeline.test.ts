import { describe, expect, it, vi } from "vitest";
import type { ScrapeCriteria, ScrapedOffre, Scraper } from "@/lib/scrapers/base";

/**
 * Le scan de bout en bout avec une source simulée (base SQLite temporaire, aucun
 * réseau) : ce que le scan cherche, le contrôle de qualité avant
 * l'enregistrement, et le journal par source.
 */

const seenCriteria: ScrapeCriteria[] = [];

const offre = (id: string, title: string, description: string): ScrapedOffre => ({
  source_id: id, url: `https://example.org/${id}`, title, company: "Exemple", country: "France", location: "Lyon",
  contract_type: "CDI", salary: null, description_html: `<p>${description}</p>`, description_text: description,
  description_status: "ok", posted_at: "2026-10-01", is_vie: false, raw_payload: {},
});

const fake: Scraper = {
  name: "hellowork",
  async *scrape(criteria, onEvent) {
    seenCriteria.push(criteria);
    onEvent({ kind: "list", source: "hellowork", total: 4 });
    const long = (s: string) => `${s} ${"Vous rejoignez une équipe engagée au service de nos clients. ".repeat(8)}`;
    const offres = [
      offre("ok-1", "Comptable général", long("Comptable général : tenue des comptes et clôtures.")),
      offre("autre-1", "Tech Lead .Net (H/F)", long("Développeur Sénior - Java / VueJS (H/F) ALTECA. Chez Alteca le management est de proximité.")),
      offre("court-1", "Comptable fournisseurs", "Comptable fournisseurs, saisie des factures."),
      offre("parasite-1", "Contrôleur de gestion", `Cette offre d'emploi n'est pas disponible dans votre pays. ${long("Contrôleur de gestion : budgets et reporting.")}`),
    ];
    for (const [i, o] of offres.entries()) {
      yield o;
      // Comme LinkedIn et Talent.com : l'annonce suit la remise de l'offre et relit
      // son statut, que le contrôle de qualité vient de réécrire.
      onEvent({ kind: "offre", source: "hellowork", index: i + 1, total: 4, status: o.description_status === "failed" ? "failed" : "ok" });
    }
  },
};

vi.mock("@/lib/scrapers/registry", () => ({
  getEnabledScrapers: () => [fake],
  scrapers: { hellowork: fake },
  VALID_SOURCES: ["hellowork"],
}));

describe("scan de bout en bout", () => {
  it("cherche les postes visés dans la zone, contrôle chaque offre et le dit dans le journal", async () => {
    const { saveProfile } = await import("@/lib/db/queries");
    const { getDb } = await import("@/lib/db");
    const { runScan } = await import("@/lib/scan/orchestrator");
    saveProfile({
      sectors: ["tech"], target_titles: ["Comptable", "Contrôleur de gestion"], target_countries: ["France"],
      search_area: "D:69", sources_enabled: ["hellowork"], preferred_contracts: ["cdi"], extraction_confidence: 80,
      experiences: [], educations: [], skills: [], languages: [{ name: "Français", level: "Natif" }],
    });

    const lines: string[] = [];
    for await (const _ of runScan((l) => lines.push(l))) void _;

    expect(seenCriteria[0].queries).toEqual(["Comptable", "Contrôleur de gestion"]);
    expect(seenCriteria[0].area).toEqual({ kind: "departement", code: "69", name: "Rhône" });
    expect(lines[0]).toBe("Recherche : « Comptable », « Contrôleur de gestion » — zone : Rhône (69)");

    const rows = getDb().prepare("SELECT source_id, description_status, description_text, quality_issues, score FROM offres ORDER BY source_id").all() as {
      source_id: string; description_status: string; description_text: string; quality_issues: string | null; score: number;
    }[];
    const by = Object.fromEntries(rows.map((r) => [r.source_id, r]));
    expect(by["ok-1"].description_status).toBe("ok");
    expect(by["autre-1"].description_status).toBe("failed");
    expect(JSON.parse(by["autre-1"].quality_issues!)).toContain("description_sans_rapport");
    expect(by["court-1"].description_status).toBe("partial");
    expect(by["parasite-1"].description_text.startsWith("Contrôleur de gestion")).toBe(true);
    // Toutes notées en fin de scan, y compris celle à la description écartée (sur son seul titre).
    expect(rows.every((r) => typeof r.score === "number")).toBe(true);

    // Les extraits comptent comme insérés ; la description d'un autre poste est un
    // échec, compté une fois (et non deux, comme sur LinkedIn en octobre 2026).
    expect(lines).toContain("[hellowork] 4 vues, 3 insérées, 1 échec");
    expect(lines.find((l) => l.startsWith("[hellowork] contrôle qualité"))).toMatch(/1 × description qui ne parle pas du poste du titre/);
  });
});

describe("une source trop lente", () => {
  it("est arrêtée au bout de son temps : ses offres lues restent, le scan est partiel", async () => {
    const { runScan } = await import("@/lib/scan/orchestrator");
    const lines: string[] = [];
    let done: any = null;
    for await (const e of runScan((l) => lines.push(l), { sourceBudgetMs: -1 })) if (e.kind === "global-done") done = e;
    expect(lines).toContain("[hellowork] arrêtée après 0 s, site trop lent : 1 offre insérée");
    expect(done.status).toBe("partial");
    expect(done.failures).toEqual([{ source: "hellowork", message: "arrêtée après 0 s, site trop lent" }]);
  });

  it("chaque requête vers un site d'offres porte un délai d'abandon", async () => {
    const { sourceFetch, SOURCE_TIMEOUT_MS } = await import("@/lib/scrapers/base");
    let signal: AbortSignal | null | undefined;
    vi.stubGlobal("fetch", async (_: unknown, init?: RequestInit) => ((signal = init?.signal), new Response("ok")));
    await sourceFetch("https://example.org/");
    vi.unstubAllGlobals();
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(SOURCE_TIMEOUT_MS).toBe(20_000);
  });
});
