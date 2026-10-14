import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ScrapedOffre } from "@/lib/scrapers/base";

/**
 * France Travail redirige une recherche courante vers sa page métier × lieu
 * (« /offres/emploi/developpeur-php/finistere/s29m1d29 »), servie en 410 mais
 * avec les offres. Le scraper rejetait la réponse : 0 offre pour un
 * développeur PHP du Finistère, sans erreur (audit d'octobre 2026).
 */

vi.mock("@/lib/scrapers/dom", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/scrapers/dom")>()),
  sleep: async () => {},
}));

const SITE = "https://candidat.francetravail.fr";
const LANDING = `${SITE}/offres/emploi/developpeur-php/finistere/s29m1d29`;
const sample = (name: string) => fs.readFileSync(path.join(__dirname, "samples", "francetravail", name), "utf-8");

function landing(): Response {
  const res = new Response(sample("recherche.html"), { status: 410, headers: { "content-type": "text/html; charset=utf-8" } });
  Object.defineProperty(res, "redirected", { value: true });
  Object.defineProperty(res, "url", { value: LANDING });
  return res;
}

async function scrape(search: () => Response, query = "Assistant service client"): Promise<{ offres: ScrapedOffre[]; searches: number }> {
  let searches = 0;
  vi.stubEnv("FT_CLIENT_ID", "");
  vi.stubEnv("FT_CLIENT_SECRET", "");
  vi.stubGlobal("fetch", async (input: string | URL | Request) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (url.pathname === "/offres/recherche") {
      searches++;
      return search();
    }
    // Ni JSON ni détail : chaque offre garde le texte de sa carte.
    return new Response(null, { status: 204 });
  });
  const { francetravailScraper } = await import("@/lib/scrapers/francetravail");
  const offres: ScrapedOffre[] = [];
  for await (const o of francetravailScraper.scrape(
    { queries: [query], sectors: [], countries: ["France"], area: { kind: "departement", code: "29", name: "Finistère" } },
    () => {}
  )) {
    offres.push(o);
  }
  return { offres, searches };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("France Travail : page métier × lieu et recherches en erreur", () => {
  it("lit la page 410 vers laquelle la recherche redirige, sans la paginer, et n'en garde que la requête", async () => {
    // La page liste tout le métier : seule l'offre qui parle d'assistant du service client reste.
    const { offres, searches } = await scrape(landing);
    expect(offres.map((o) => o.source_id)).toEqual(["900EEEE"]);
    expect(searches).toBe(1);
    // « Développeur PHP » : aucune des cinq cartes n'en parle (Tech Lead .Net, station-service…).
    expect((await scrape(landing, "Développeur PHP")).offres).toEqual([]);
  });

  it("les mots de la requête couvrent le féminin et le pluriel", async () => {
    const { queryStems } = await import("@/lib/scrapers/francetravail");
    expect(queryStems("Formateur")).toEqual(["format"]);
    expect(queryStems("Conducteur de travaux")).toEqual(["conduct", "trav"]);
    expect(queryStems("Développeur PHP")).toEqual(["developp", "php"]);
  });

  it("une recherche en erreur fait échouer la source au lieu de rendre zéro offre", async () => {
    await expect(scrape(() => new Response("", { status: 503 }))).rejects.toThrow("France Travail HTTP 503");
  });
});
