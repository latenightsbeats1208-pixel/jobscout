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
  // Structure réelle d'une carte (octobre 2026) : entreprise et lieu dans <address>,
  // contrat en pictogramme titré, date dans <time>, lien « Voir plus » dans l'extrait.
  const card = (id: string, title: string) => `
    <div data-job-id="${id}" data-new-id="9${id.length}0${id.length}" data-testid="jobcard-container-9${id.length}0${id.length}">
      <article data-testid="job-card-unified"><header><figure aria-hidden="true"></figure>
        <div><h2>${title}</h2><address><span>Entreprise Exemple</span><span aria-hidden="true">•</span><span>Écully, Auvergne-Rhone-Alpes, France</span></address></div>
        <div><button aria-label="Save job"><span></span></button></div>
      </header>
      <div><div><div><svg title="CDI"></svg><span>CDI</span></div><div><svg title="Quick Apply"></svg><span>Quick Apply</span></div></div>
        <p>Nous recherchons un comptable pour tenir la comptabilité générale et préparer les clôtures mensuelles...<!-- --> <a href="/view?id=${id}-n">Voir plus</a></p></div>
      <footer><div><time dateTime="2026-10-06T17:10:50Z">Dernière mise à jour : il y a 5 jours</time></div></footer></article>
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

  // L'ancienne lecture cherchait entreprise et lieu dans des <p> : aucun lieu sur
  // 225 offres, et le nom de l'entreprise pris pour le contrat.
  it("lit l'entreprise, le lieu, le contrat, la date et le lien de la carte", async () => {
    respond = talentResponder;
    const { talentScraper } = await import("@/lib/scrapers/talent");
    const [o] = await collect(talentScraper.scrape(criteria({ queries: ["Comptable"], area: null, maxOffres: 1 }), () => {}));
    expect(o.company).toBe("Entreprise Exemple");
    expect(o.location).toBe("Écully");
    expect(o.contract_type).toBe("CDI"); // « Quick Apply » n'est pas un contrat
    expect(o.posted_at).toBe("2026-10-06");
    expect(o.url).toMatch(/view\?id=.*-n$/); // lien canonique de la carte
    expect(o.source_id).not.toMatch(/-n$/); // la clé en base ne change pas
  });

  it("complète la carte par les données structurées de la page de détail", async () => {
    respond = (url) =>
      url.pathname === "/jobs"
        ? html(`<div data-job-id="x1" data-testid="jobcard-container-1"><article data-testid="job-card-unified"><header><div><h2>Comptable H/F</h2></div></header></article></div>`)
        : html(`<script type="application/ld+json">${JSON.stringify({
            "@context": "https://schema.org",
            "@graph": [{ "@type": "BreadcrumbList" }, {
              "@type": "JobPosting", title: "Comptable H/F", description: `<p>${detailText("Comptable")}</p>`, datePosted: "2026-10-01",
              hiringOrganization: { name: "Exemple SA" }, jobLocation: { address: { addressLocality: "Lyon", addressCountry: "fr" } },
            }],
          })}</script>`);
    const { talentScraper } = await import("@/lib/scrapers/talent");
    const [o] = await collect(talentScraper.scrape(criteria({ queries: ["Comptable"], area: null, maxOffres: 1 }), () => {}));
    expect([o.company, o.location, o.posted_at]).toEqual(["Exemple SA", "Lyon", "2026-10-01"]);
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

describe("Welcome to the Jungle : zone", () => {
  it("filtre sur le département, puis sa région quand il est trop maigre ; les autres pays visés restent", async () => {
    const filters: string[] = [];
    respond = async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as { requests: { params: string }[] };
      const params = new URLSearchParams(body.requests[0].params);
      const f = params.get("filters") ?? "";
      filters.push(f);
      // Département : 2 offres seulement ; région : 30.
      const n = f.includes('"Rhône"') && !f.includes('"Ain"') ? 2 : 30;
      const hits = Array.from({ length: n }, (_, i) => ({
        objectID: `${n}-${i}`, slug: `${n}-${i}`, name: "Comptable H/F", published_at: "2026-10-01", contract_type: "full_time",
        organization: { name: "Exemple", slug: "exemple" }, offices: [{ city: n === 2 ? "Lyon" : "Grenoble", country: "France", country_code: "FR" }],
        summary: detailText("Comptable"),
      }));
      return new Response(JSON.stringify({ results: [{ hits, nbPages: 1 }] }), { headers: { "content-type": "application/json" } });
    };
    const { wttjScraper } = await import("@/lib/scrapers/wttj");
    const offres = await collect(wttjScraper.scrape(criteria({ queries: ["Comptable"], countries: ["France", "Suisse"], maxOffres: 10 }), () => {}));
    expect(filters[0]).toBe('offices.district:"Rhône" OR remote:"fulltime" OR offices.country_code:"CH"');
    expect(filters[1]).toContain('offices.district:"Isère"'); // élargi à Auvergne-Rhône-Alpes
    // Les offres du département d'abord, puis la région pour compléter la part.
    expect(offres.slice(0, 2).map((o) => o.location)).toEqual(["Lyon", "Lyon"]);
    expect(offres).toHaveLength(10);
  });
});

describe("France Travail (pages publiques)", () => {
  // Carte réelle d'une offre anonyme (octobre 2026) : le département en tête de ligne, sans entreprise.
  const card = (id: string, subtext: string, date: string) => `
    <li data-id-offre="${id}" class="result"><a href="/offres/recherche/detail/${id}"><div class="media-body">
      <h2 class="t4 media-heading"><span class="media-heading-title">Agent de service (H/F)</span></h2>
      <p translate="no" class="subtext">${subtext}</p>
      <p class="description">Entretien des locaux et des espaces communs de la résidence, en équipe avec les agents du site...</p>
      <p class="contrat visible-xs">CDI - Temps plein</p><p class="date">${date}</p>
    </div></a></li>`;

  it("offre anonyme : ni département pris pour l'entreprise, ni date perdue", async () => {
    respond = (url) => {
      if (url.pathname === "/offres/recherche") {
        return html(url.searchParams.get("page") === "1"
          ? card("901AAAA", "26 - <span>Romans-sur-Isère</span>", "Publié hier") + card("901BBBB", "RAVI PROPRETE - <span>26 - Chatuzange-le-Goubet</span>", "Publié il y a 3 jours")
          : "");
      }
      if (url.pathname.startsWith("/api-descriptifoffre/")) {
        return new Response(JSON.stringify({ numeroOffre: `Offre n° ${url.pathname.split("/").pop()}`, descriptif: detailText("Agent de service"), dateDerniereModification: "1er octobre 2026" }), { headers: { "content-type": "application/json" } });
      }
      return html("");
    };
    const { francetravailScraper } = await import("@/lib/scrapers/francetravail");
    const offres = await collect(francetravailScraper.scrape(criteria({ queries: ["Agent de service"], area: null }), () => {}));
    const day = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
    expect(offres.map((o) => [o.company, o.location, o.posted_at])).toEqual([
      ["", "Romans-sur-Isère", day(1)],
      ["RAVI PROPRETE", "Chatuzange-le-Goubet", day(3)],
    ]);
    // La date de la carte n'entre pas dans l'extrait de l'annonce.
    expect(offres.every((o) => !o.description_text.includes("Publié"))).toBe(true);
  });

  it("lit les dates écrites en toutes lettres", async () => {
    const { parseFrenchDate, parsePublishedAgo } = await import("@/lib/scrapers/francetravail");
    expect(parseFrenchDate("24 septembre 2026")).toBe("2026-09-24");
    expect(parseFrenchDate("1er août 2026")).toBe("2026-08-01");
    expect(parseFrenchDate("septembre")).toBeNull();
    const now = new Date("2026-10-12T10:00:00Z");
    expect(parsePublishedAgo("Publié aujourd'hui", now)).toBe("2026-10-12");
    expect(parsePublishedAgo("Publié il y a 6 jours", now)).toBe("2026-10-06");
    expect(parsePublishedAgo("Publié il y a plus de 30 jours", now)).toBeNull();
  });

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

describe("LinkedIn", () => {
  it("pays : JSON-LD, puis libellé de lieu, puis pays de la recherche (lieu réduit à la ville)", async () => {
    const { linkedinCountry } = await import("@/lib/scrapers/linkedin");
    expect(linkedinCountry(null, "Lyon", "France")).toBe("France");
    expect(linkedinCountry(null, "Ville de Paris", "France")).toBe("France");
    expect(linkedinCountry(null, "Région métropolitaine de Kansas City", "États-Unis")).toBe("États-Unis");
    // Le libellé de lieu et le JSON-LD l'emportent sur la recherche.
    expect(linkedinCountry(null, "Paris, Île-de-France, France", "Suisse")).toBe("France");
    expect(linkedinCountry("CH", "Genève", "France")).toBe("Suisse");
    // Recherche sans pays : rien n'est deviné.
    expect(linkedinCountry(null, "Lyon et périphérie", null)).toBeNull();
  });
});
