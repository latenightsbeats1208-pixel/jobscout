import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { ScrapedOffre, Scraper } from "@/lib/scrapers/base";
import type { OrchestratorEvent } from "@/lib/scan/orchestrator";

/**
 * Un scan dont une source échoue est « partiel », pas « terminé » : cas réel
 * des trois premiers scans de la base d'évaluation, où LinkedIn plantait au
 * lancement du moteur et où le scan se disait pourtant terminé.
 */

const offre = (id: string): ScrapedOffre => ({
  source_id: id, url: `https://example.org/${id}`, title: "Comptable général", company: "Exemple", country: "France",
  location: "Lyon", contract_type: "CDI", salary: null, description_html: "<p>…</p>",
  description_text: `Comptable général : tenue des comptes et clôtures. ${"Vous rejoignez une équipe engagée. ".repeat(15)}`,
  description_status: "ok", posted_at: "2026-10-01", is_vie: false, raw_payload: {},
});

const working: Scraper = {
  name: "hellowork",
  async *scrape(_c, onEvent) {
    onEvent({ kind: "list", source: "hellowork", total: 1 });
    yield offre("ok-1");
  },
};
const broken: Scraper = {
  name: "linkedin",
  async *scrape() {
    throw new Error("Le moteur LinkedIn (Chromium) n'est pas installé.");
  },
};

// Répond, mais ne trouve rien : la recherche est à revoir, la source n'a pas échoué.
const empty: Scraper = {
  name: "linkedin",
  async *scrape(_c, onEvent) {
    onEvent({ kind: "list", source: "linkedin", total: 0 });
    onEvent({ kind: "done", source: "linkedin", seen: 0, ok: 0, failed: 0 });
  },
};

let enabled: Scraper[] = [];
vi.mock("@/lib/scrapers/registry", () => ({
  getEnabledScrapers: () => enabled,
  scrapers: {},
  VALID_SOURCES: ["hellowork", "linkedin"],
}));

beforeAll(async () => {
  // Aucune requête réseau : la vérification de fin de scan ne conclut rien.
  vi.stubGlobal("fetch", async () => new Response("", { status: 503 }));
  const { saveProfile } = await import("@/lib/db/queries");
  saveProfile({
    sectors: ["tech"], target_titles: ["Comptable"], target_countries: ["France"], search_area: "",
    sources_enabled: ["hellowork", "linkedin"], preferred_contracts: ["cdi"], extraction_confidence: 80,
    experiences: [], educations: [], skills: [], languages: [{ name: "Français", level: "Natif" }],
  });
});
afterAll(() => vi.unstubAllGlobals());

async function scan() {
  const { runScan } = await import("@/lib/scan/orchestrator");
  const { getDb } = await import("@/lib/db");
  const lines: string[] = [];
  const events: OrchestratorEvent[] = [];
  for await (const e of runScan((l) => lines.push(l))) events.push(e);
  const run = getDb().prepare("SELECT status, summary, log FROM scan_runs ORDER BY id DESC LIMIT 1").get() as { status: string; summary: string; log: string };
  return { lines, events, run, done: events.find((e) => e.kind === "global-done") as Extract<OrchestratorEvent, { kind: "global-done" }> };
}

describe("statut du scan", () => {
  it("une source en échec : scan partiel, avec la source et sa cause", async () => {
    enabled = [working, broken];
    const { lines, events, run, done } = await scan();
    expect(done).toMatchObject({ status: "partial", total_inserted: 1 });
    expect(done.failures).toEqual([{ source: "linkedin", message: "Le moteur LinkedIn (Chromium) n'est pas installé." }]);
    expect(events).toContainEqual({ kind: "error", source: "linkedin", message: "Le moteur LinkedIn (Chromium) n'est pas installé." });
    expect(lines).toContain("[linkedin] échec : Le moteur LinkedIn (Chromium) n'est pas installé.");
    expect(lines).not.toContain("[linkedin] 0 vues, 0 insérées, 0 échecs");
    expect(lines.at(-1)).toBe("Scan partiel : LinkedIn en échec.");
    expect(run.status).toBe("partial");
    expect(JSON.parse(run.summary).failures).toHaveLength(1);
    expect(JSON.parse(run.log)).toContain("Scan partiel : LinkedIn en échec.");

    const { lastFinishedScan } = await import("@/lib/db/scans");
    expect(lastFinishedScan()).toMatchObject({ status: "partial", failures: [{ source: "linkedin" }] });
  });

  it("toutes les sources en échec : scan en échec", async () => {
    enabled = [broken];
    const { done, run } = await scan();
    expect(done.status).toBe("failed");
    expect(run.status).toBe("failed");
  });

  it("une source sans aucune offre le dit, sans faire échouer le scan", async () => {
    enabled = [working, empty];
    const { done, lines } = await scan();
    expect(done.status).toBe("done");
    expect(lines).toContain("[linkedin] aucune offre trouvée pour ces recherches");
    expect(lines).not.toContain("[linkedin] 0 vue, 0 insérée, 0 échec");
  });

  it("toutes les sources répondent : scan terminé", async () => {
    enabled = [working];
    const { done, run, lines } = await scan();
    expect(done).toMatchObject({ status: "done", failures: [] });
    expect(run.status).toBe("done");
    expect(lines.some((l) => l.startsWith("Scan partiel"))).toBe(false);
  });
});
