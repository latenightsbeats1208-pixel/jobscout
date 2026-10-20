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

/**
 * Réponse telle que l'application la reçoit : Next recopie chaque réponse de
 * fetch en gardant son adresse finale, mais pas `redirected`, qui y vaut false.
 * Le scraper s'y fiait : « France Travail HTTP 410 » et un scan partiel pour la
 * recherche « Acheteur » du 19 octobre 2026.
 */
function landing(status = 410): Response {
  const res = new Response(sample("recherche.html"), { status, headers: { "content-type": "text/html; charset=utf-8" } });
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

  it("reconnaît la page à son adresse, même servie en 200", async () => {
    const { offres, searches } = await scrape(() => landing(200));
    expect(offres.map((o) => o.source_id)).toEqual(["900EEEE"]);
    expect(searches).toBe(1);
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

describe("France Travail : pagination", () => {
  // Le site pagine avec `range` (« 20-39 ») et ignore `page` : les pages 2 et 3
  // redonnaient la première, et chaque requête s'arrêtait à 20 offres
  // (« Acheteur » en Île-de-France : 921 annoncées, 20 lues, 19 octobre 2026).
  const card = (id: string, title = "Acheteur (H/F)") => `
    <li data-id-offre="${id}" class="result"><a href="/offres/recherche/detail/${id}"><div class="media-body">
      <h2 class="t4 media-heading"><span class="media-heading-title">${title}</span></h2>
      <p translate="no" class="subtext">ACHATS SA - <span>75 - Paris</span></p>
      <p class="description">Au sein de la direction des achats, vous pilotez un portefeuille de fournisseurs et négociez les contrats...</p>
      <p class="contrat visible-xs">CDI</p><p class="date">Publié hier</p>
    </div></a></li>`;

  it("lit les tranches suivantes avec `range`, jusqu'au quota de la requête", async () => {
    const ranges: string[] = [];
    vi.stubEnv("FT_CLIENT_ID", "");
    vi.stubEnv("FT_CLIENT_SECRET", "");
    vi.stubGlobal("fetch", async (input: string | URL | Request) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
      if (url.pathname !== "/offres/recherche") return new Response(null, { status: 204 });
      const range = url.searchParams.get("range") ?? "";
      ranges.push(range);
      const start = Number(range.split("-")[0]);
      return new Response(Array.from({ length: 20 }, (_, i) => card(`9${String(start + i).padStart(6, "0")}`)).join(""), { headers: { "content-type": "text/html" } });
    });
    const { francetravailScraper } = await import("@/lib/scrapers/francetravail");
    const offres: ScrapedOffre[] = [];
    for await (const o of francetravailScraper.scrape({ queries: ["Acheteur"], sectors: [], countries: ["France"], maxOffres: 45 }, () => {})) offres.push(o);
    expect(ranges).toEqual(["0-19", "20-39", "40-59"]);
    expect(offres).toHaveLength(45);
    expect(new Set(offres.map((o) => o.source_id)).size).toBe(45);
  });

  it("s'arrête quand les pages suivantes passent aux offres voisines", async () => {
    // « Acheteur Junior » : la deuxième page ramenait « Junior product engineer » et « Talent Acquisition ».
    const ranges: string[] = [];
    vi.stubEnv("FT_CLIENT_ID", "");
    vi.stubEnv("FT_CLIENT_SECRET", "");
    vi.stubGlobal("fetch", async (input: string | URL | Request) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
      if (url.pathname !== "/offres/recherche") return new Response(null, { status: 204 });
      const range = url.searchParams.get("range") ?? "";
      ranges.push(range);
      const start = Number(range.split("-")[0]);
      const cards = Array.from({ length: 20 }, (_, i) =>
        card(`8${String(start + i).padStart(6, "0")}`, start === 0 || i < 5 ? "Acheteur Junior (H/F)" : "Junior product engineer (H/F)")
      );
      return new Response(cards.join(""), { headers: { "content-type": "text/html" } });
    });
    const { francetravailScraper } = await import("@/lib/scrapers/francetravail");
    const offres: ScrapedOffre[] = [];
    for await (const o of francetravailScraper.scrape({ queries: ["Acheteur Junior"], sectors: [], countries: ["France"], maxOffres: 60 }, () => {})) offres.push(o);
    expect(ranges).toEqual(["0-19", "20-39"]);
    expect(offres).toHaveLength(25);
    expect(offres.every((o) => o.title.startsWith("Acheteur Junior"))).toBe(true);
  });
});
