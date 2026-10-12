import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ScrapeCriteria, ScrapedOffre } from "@/lib/scrapers/base";
import { parseSearchArea } from "@/lib/geo/fr";

/**
 * Collecteurs sur pages enregistrées, sans réseau : chaque requête doit avoir
 * sa part du quota, et la zone de recherche partir là où la source l'accepte.
 * Les pages reprennent la structure des vraies pages (relevée le 12/10/2026),
 * avec un contenu fictif.
 */

// Aucune attente entre deux requêtes pendant les tests.
vi.mock("@/lib/scrapers/dom", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/scrapers/dom")>()),
  sleep: async () => {},
}));

const requests: string[] = [];
let respond: (url: URL, init?: RequestInit) => Response | Promise<Response>;

beforeEach(() => {
  requests.length = 0;
  delete process.env.FT_CLIENT_ID;
  delete process.env.FT_CLIENT_SECRET;
  vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    requests.push(url.href);
    return respond(url, init);
  });
});
afterEach(() => vi.unstubAllGlobals());

const html = (body: string) => new Response(`<!doctype html><html><body>${body}</body></html>`, { headers: { "content-type": "text/html" } });
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-");

async function collect(gen: AsyncGenerator<ScrapedOffre>): Promise<ScrapedOffre[]> {
  const out: ScrapedOffre[] = [];
  for await (const o of gen) out.push(o);
  return out;
}

const criteria = (over: Partial<ScrapeCriteria>): ScrapeCriteria => ({
  queries: ["Comptable", "Contrôleur de gestion"],
  sectors: [],
  countries: ["France"],
  area: parseSearchArea("D:69"),
  maxOffres: 10,
  ...over,
});

const detailText = (title: string) =>
  `${title} : vous tenez les comptes, préparez les clôtures et suivez la trésorerie avec l'équipe finance. `.repeat(3);

describe("HelloWork", () => {
  // Carte réelle : champ caché offerId, <h3> « Titre / Entreprise », ligne « Ville - 69 ».
  const card = (id: string, title: string) => `
    <li><a href="/fr-fr/emplois/${id}.html"><h3>
      ${title}
      Entreprise Exemple
    </h3></a><input type="hidden" name="offerId" value="${id}">
    <div>Lyon - 69</div><div>CDI</div></li>`;

  it("cherche chaque poste dans la zone choisie, chacun avec sa part du quota", async () => {
    respond = (url) => {
      if (url.pathname.endsWith("/recherche.html")) {
        const k = url.searchParams.get("k")!;
        const page = Number(url.searchParams.get("p") ?? 1);
        return html(Array.from({ length: 12 }, (_, i) => card(`${slug(k)}-${page}-${i}`, `${k} H/F`)).join(""));
      }
      return html(`<div itemprop="description"><p>${detailText("Poste")}</p></div>`);
    };
    const { helloworkScraper } = await import("@/lib/scrapers/hellowork");
    const offres = await collect(helloworkScraper.scrape(criteria({}), () => {}));

    const searches = requests.filter((r) => r.includes("/recherche.html")).map((r) => new URL(r).searchParams);
    expect(searches.map((p) => p.get("k"))).toEqual(["Comptable", "Contrôleur de gestion"]);
    expect(searches.every((p) => p.get("l") === "Rhône")).toBe(true);
    // Quota de 10 partagé : 5 offres par poste visé, et non 10 pour le premier.
    expect(offres.filter((o) => o.title.startsWith("Comptable"))).toHaveLength(5);
    expect(offres.filter((o) => o.title.startsWith("Contrôleur"))).toHaveLength(5);
  });

  it("sans zone, cherche dans toute la France", async () => {
    respond = (url) => (url.pathname.endsWith("/recherche.html") ? html("") : html(""));
    const { helloworkScraper } = await import("@/lib/scrapers/hellowork");
    await collect(helloworkScraper.scrape(criteria({ area: null, queries: ["Comptable"] }), () => {}));
    expect(new URL(requests[0]).searchParams.get("l")).toBe("France");
  });
});

describe("Talent.com", () => {
  // Structure réelle d'une carte (octobre 2026) : entreprise et lieu dans <address>.
  const card = (id: string, title: string) => `
    <div data-job-id="${id}" data-testid="jobcard-container-${id}">
      <article data-testid="job-card-unified"><header><figure aria-hidden="true"></figure>
        <div><h2>${title}</h2><address><span>Entreprise Exemple</span><span aria-hidden="true">•</span><span>Écully, Auvergne-Rhone-Alpes, France</span></address></div>
        <div><button aria-label="Save job"><span></span></button></div>
      </header><div><div><div><svg title="CDI"></svg></div></div></div></article>
    </div>`;
  const talentResponder = (url: URL) => {
    if (url.pathname === "/jobs") {
      const k = url.searchParams.get("k")!;
      return html(Array.from({ length: 12 }, (_, i) => card(`${url.hostname.slice(0, 2)}${slug(k)}${i}`, `${k} H/F`)).join(""));
    }
    return html(`<div class="job-description">${detailText("Poste")}</div>`);
  };

  it("applique la zone au seul site français, quota partagé entre les postes", async () => {
    respond = talentResponder;
    const { talentScraper } = await import("@/lib/scrapers/talent");
    const offres = await collect(talentScraper.scrape(criteria({ countries: ["France", "Belgique"], maxOffres: 20 }), () => {}));

    const searches = requests.filter((r) => new URL(r).pathname === "/jobs").map((r) => new URL(r));
    const fr = searches.filter((u) => u.hostname === "fr.talent.com");
    const be = searches.filter((u) => u.hostname === "be.talent.com");
    expect(fr.every((u) => u.searchParams.get("l") === "Rhône")).toBe(true);
    expect(be.every((u) => u.searchParams.get("l") === "")).toBe(true);
    expect(new Set(fr.map((u) => u.searchParams.get("k")))).toEqual(new Set(["Comptable", "Contrôleur de gestion"]));
    // 20 offres pour 2 pays → 10 par pays → 5 par poste visé dans chaque pays.
    expect(offres.filter((o) => o.title.startsWith("Comptable"))).toHaveLength(10);
  });

  // Bug connu (point 4 du plan d'amélioration) : l'analyseur cherche l'entreprise et
  // le lieu dans des <p> alors que la carte les range dans <address>, et prend le
  // premier <span> venu — l'entreprise — pour le contrat. Ce test passera le jour
  // de la correction : retirer alors « .fails ».
  it.fails("lit l'entreprise, le lieu et le contrat de la carte", async () => {
    respond = talentResponder;
    const { talentScraper } = await import("@/lib/scrapers/talent");
    const [o] = await collect(talentScraper.scrape(criteria({ queries: ["Comptable"], area: null, maxOffres: 1 }), () => {}));
    expect(o.company).toBe("Entreprise Exemple");
    expect(o.location).toBe("Écully");
    expect(o.contract_type).not.toBe("Entreprise Exemple");
  });
});

describe("Welcome to the Jungle", () => {
  it("garde la part de chaque poste visé, les plus récentes d'abord", async () => {
    respond = async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as { requests: { params: string }[] };
      const params = new URLSearchParams(body.requests[0].params);
      const q = params.get("query")!;
      const page = Number(params.get("page"));
      // Le premier poste a beaucoup d'offres très récentes : sans part réservée, il prenait tout.
      const recent = q === "Comptable" ? "2026-10-10" : "2026-09-01";
      const hits = Array.from({ length: 50 }, (_, i) => ({
        objectID: `${slug(q)}-${page}-${i}`,
        slug: `${slug(q)}-${page}-${i}`,
        name: `${q} H/F`,
        published_at: recent,
        contract_type: "full_time",
        organization: { name: "Exemple", slug: "exemple" },
        offices: [{ city: "Paris", country: "France", country_code: "FR" }],
        summary: detailText(q),
      }));
      return new Response(JSON.stringify({ results: [{ hits, nbPages: 2 }] }), { headers: { "content-type": "application/json" } });
    };
    const { wttjScraper } = await import("@/lib/scrapers/wttj");
    const offres = await collect(wttjScraper.scrape(criteria({ maxOffres: 40 }), () => {}));
    expect(offres.filter((o) => o.title.startsWith("Comptable"))).toHaveLength(20);
    expect(offres.filter((o) => o.title.startsWith("Contrôleur"))).toHaveLength(20);
  });
});

describe("France Travail (pages publiques)", () => {
  it("envoie la zone en code « 69D » ou « 84R » pour chaque poste visé", async () => {
    respond = () => html("");
    const { francetravailScraper } = await import("@/lib/scrapers/francetravail");
    await collect(francetravailScraper.scrape(criteria({}), () => {}));
    await collect(francetravailScraper.scrape(criteria({ queries: ["Comptable"], area: parseSearchArea("R:84") }), () => {}));
    const searches = requests.filter((r) => r.includes("/offres/recherche?")).map((r) => new URL(r).searchParams);
    expect(searches.map((p) => [p.get("motsCles"), p.get("lieux")])).toEqual([
      ["Comptable", "69D"],
      ["Contrôleur de gestion", "69D"],
      ["Comptable", "84R"],
    ]);
  });
});
