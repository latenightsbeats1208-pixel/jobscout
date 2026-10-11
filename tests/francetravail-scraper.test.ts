import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { ScrapedOffre } from "@/lib/scrapers/base";

/**
 * France Travail sans clé d'API : la liste vient de la page de recherche, la
 * description de chaque offre du JSON que lit la page de détail.
 * Régression visée : la page de détail n'embarque plus la description, et le
 * scraper y prenait la carte d'une offre voisine (« D'autres offres peuvent
 * vous intéresser ») ou l'aide de la page de résultats — 50 offres sur 50
 * dans la base d'évaluation. Pages enregistrées (balisage du site, offres
 * fictives) servies par un faux fetch : aucun appel réseau.
 */

vi.mock("@/lib/scrapers/dom", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/scrapers/dom")>()),
  sleep: async () => {},
}));

const SITE = "https://candidat.francetravail.fr";
const SAMPLES = path.join(__dirname, "samples", "francetravail");
const sample = (name: string) => fs.readFileSync(path.join(SAMPLES, name), "utf-8");

const html = (body: string) =>
  new Response(body, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
const json = (body: string) =>
  new Response(body, { status: 200, headers: { "content-type": "application/json" } });
const noContent = () => new Response(null, { status: 204 });

function redirectedTo(url: string, body: string): Response {
  const res = html(body);
  Object.defineProperty(res, "redirected", { value: true });
  Object.defineProperty(res, "url", { value: url });
  return res;
}

const ROUTES: Record<string, () => Response> = {
  // Cas nominal : description lue dans le JSON de l'offre.
  "/api-descriptifoffre/offre/900AAAA": () => json(sample("descriptif-900AAAA.json")),
  "/offres/recherche/detail/900AAAA": () => html(sample("detail-autres-offres.html")),
  // JSON en panne : la page de détail n'a que les cartes d'offres voisines.
  "/api-descriptifoffre/offre/900BBBB": () => new Response("", { status: 503 }),
  "/offres/recherche/detail/900BBBB": () => html(sample("detail-autres-offres.html")),
  // Offre inconnue du JSON : la page de détail n'a que l'aide de la recherche.
  "/api-descriptifoffre/offre/900CCCC": noContent,
  "/offres/recherche/detail/900CCCC": () => html(sample("detail-sans-autres-offres.html")),
  // Offre retirée : le détail renvoie vers la page de résultats.
  "/api-descriptifoffre/offre/7900001": noContent,
  "/offres/recherche/detail/7900001": () =>
    redirectedTo(`${SITE}/offres/recherche?motsCles=finance`, sample("recherche.html")),
  // Le JSON répond pour une autre offre que celle demandée.
  "/api-descriptifoffre/offre/900EEEE": () => json(sample("descriptif-900AAAA.json")),
  "/offres/recherche/detail/900EEEE": () => html(sample("detail-autres-offres.html")),
};

const requested: string[] = [];
const unexpected: string[] = [];

async function fakeFetch(input: string | URL | Request): Promise<Response> {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  requested.push(url.pathname);
  if (url.origin === SITE && url.pathname === "/offres/recherche") {
    return html(url.searchParams.get("page") === "1" ? sample("recherche.html") : "<html><body></body></html>");
  }
  const route = url.origin === SITE ? ROUTES[url.pathname] : undefined;
  if (!route) {
    // Le scraper avale les erreurs de détail : on les relève à part.
    unexpected.push(url.href);
    throw new Error(`requête inattendue : ${url.href}`);
  }
  return route();
}

const offres: ScrapedOffre[] = [];
const byId = (id: string) => offres.find((o) => o.source_id === id)!;

beforeAll(async () => {
  vi.stubEnv("FT_CLIENT_ID", "");
  vi.stubEnv("FT_CLIENT_SECRET", "");
  vi.stubGlobal("fetch", fakeFetch);
  const { francetravailScraper } = await import("@/lib/scrapers/francetravail");
  for await (const o of francetravailScraper.scrape({ sectors: ["tech"], countries: ["France"] }, () => {})) {
    offres.push(o);
  }
});

afterAll(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");

// Mots de 4 lettres et plus de l'intitulé (le contrôle lancé sur la base d'évaluation).
const titleWords = (title: string) =>
  (norm(title).match(/[a-z]+/g) ?? []).filter((w) => w.length >= 4 && w !== "tech" && w !== "start");

// Textes de la page de détail ou de résultats qui ne décrivent pas l'offre.
const FOREIGN_TEXTS = [
  "Développeur Sénior",
  "ENTREPRISE VOISINE",
  "Manutentionnaire",
  "D'autres offres peuvent vous intéresser",
  "restituée par ordre de pertinence",
  "Réussir son CV",
];

describe("France Travail (pages HTML, sans clé d'API) — description de chaque offre", () => {
  it("chaque carte de la liste donne une offre, sans aucun appel réseau imprévu", () => {
    expect(offres.map((o) => o.source_id)).toEqual(["900AAAA", "900BBBB", "900CCCC", "7900001", "900EEEE"]);
    expect(unexpected).toEqual([]);
  });

  it("aucune description n'est celle d'une autre offre ni un texte de la page de résultats", () => {
    for (const o of offres) {
      expect(o.description_html, o.source_id).not.toMatch(/data-id-offre|media-heading/);
      for (const t of FOREIGN_TEXTS) expect(o.description_text, `${o.source_id} : « ${t} »`).not.toContain(t);
      const text = norm(o.description_text);
      expect(titleWords(o.title).some((w) => text.includes(w)), `${o.source_id} : ${o.title}`).toBe(true);
    }
  });

  it("la description complète vient du JSON de l'offre, compétences et salaire compris", () => {
    const o = byId("900AAAA");
    expect(o.description_status).toBe("ok");
    expect(o.scrape_errors).toBeUndefined();
    expect(o.title).toBe("Tech Lead .Net (H/F)");
    expect(o.company).toBe("EXEMPLE CONSEIL");
    expect(o.url).toBe(`${SITE}/offres/recherche/detail/900AAAA`);
    expect(o.description_text).toMatch(/^Au sein d'une équipe Tech & Product/);
    expect(o.description_text).toContain("huit ans d'expérience en développement .NET");
    expect(o.description_text).toContain("Compétences : Concevoir une application web, Application web");
    expect(o.description_html).toContain("Tech &amp; Product");
    expect(o.salary).toBe("Annuel de 50000.0 Euros à 60000.0 Euros");
    // Le JSON suffit : la page de détail n'est pas téléchargée.
    expect(requested).not.toContain("/offres/recherche/detail/900AAAA");
  });

  it("JSON indisponible et page de détail sans description : snippet de la carte, jamais une offre voisine", () => {
    for (const id of ["900BBBB", "900CCCC"]) {
      expect(requested).toContain(`/offres/recherche/detail/${id}`);
    }
    expect(byId("900BBBB").description_text).toContain("Employé polyvalent de notre station-service");
    expect(byId("900CCCC").description_text).toContain("le chef de service éducatif encadre l'équipe");
  });

  it("détail renvoyé vers la page de résultats : description en échec, texte des résultats non stocké", () => {
    const o = byId("7900001");
    expect(o.description_status).toBe("failed");
    expect(o.scrape_errors).toMatch(/page de résultats/);
    expect(o.description_text).not.toContain("Tech Lead .Net");
    expect(o.description_text).toContain("nous recherchons son head of finance");
  });

  it("JSON d'une autre offre que celle demandée : description en échec", () => {
    const o = byId("900EEEE");
    expect(o.description_status).toBe("failed");
    expect(o.scrape_errors).toMatch(/autre offre/);
    expect(o.description_text).not.toContain("Tech Lead");
    expect(o.salary).toBeNull();
  });
});
