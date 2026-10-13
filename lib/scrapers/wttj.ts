import { quotaPerQuery } from "@/lib/scan/search-plan";
import "server-only";
import type { Scraper, ScrapedOffre, ScrapeCriteria, ProgressEvent } from "./base";
import { htmlToText } from "./base";
import { detectVie } from "@/lib/vie";
import { normalizeCountryName, nameToCode } from "@/lib/countries";
import { DEPARTEMENTS, type SearchArea } from "@/lib/geo/fr";

/**
 * Welcome to the Jungle via son index de recherche public (Algolia) — le même
 * que celui du site. Historique : le scraping des fiches HTML (sitemap +
 * JSON-LD) est bloqué depuis l'été 2026 par un défi AWS WAF (HTTP 202 +
 * JavaScript obligatoire) dès les premières requêtes, ce qui interrompait le
 * scan. L'index Algolia expose les champs utiles (résumé,
 * missions, profil, contrat, lieu, date, salaire) sans aucune page HTML.
 * Clé de recherche publique embarquée dans le front WTTJ (lecture seule).
 */
const SOURCE = "wttj";
const ALGOLIA_URL = "https://csekhvms53-dsn.algolia.net/1/indexes/*/queries";
const ALGOLIA_APP_ID = process.env.WTTJ_ALGOLIA_APP || "CSEKHVMS53";
const ALGOLIA_API_KEY = process.env.WTTJ_ALGOLIA_KEY || "4bd8f6215d0cc52b26430765769e65a0";
const INDEX = "wttj_jobs_production_fr";
const SITE = "https://www.welcometothejungle.com";
/** Pour vérifier qu'une offre est toujours publiée (lib/scrapers/liveness.ts). */
export const WTTJ_ALGOLIA = {
  objectsUrl: ALGOLIA_URL.replace(/\/queries$/, "/objects"),
  appId: ALGOLIA_APP_ID,
  apiKey: ALGOLIA_API_KEY,
  index: INDEX,
  site: SITE,
};
const HITS_PER_PAGE = 50;
const PAGES_PER_QUERY = 2;

type Hit = {
  objectID: string;
  slug: string;
  name: string;
  reference?: string | null;
  published_at?: string | null;
  contract_type?: string | null;
  contract_duration_minimum?: number | null;
  language?: string | null;
  remote?: string | null;
  salary_minimum?: number | null;
  salary_maximum?: number | null;
  salary_currency?: string | null;
  salary_period?: string | null;
  organization?: { name?: string | null; slug?: string | null } | null;
  offices?: { city?: string | null; country?: string | null; country_code?: string | null }[] | null;
  summary?: unknown;
  key_missions?: unknown;
  profile?: unknown;
  benefits?: unknown;
};

const CONTRACT_LABELS: Record<string, string> = {
  full_time: "CDI",
  temporary: "CDD",
  internship: "Stage",
  apprenticeship: "Alternance",
  vie: "V.I.E",
  freelance: "Freelance",
  part_time: "Temps partiel",
  volunteer_work: "Bénévolat",
  other: "Autre",
};

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Les champs Algolia sont du texte brut (parfois avec du HTML léger) : on normalise en paragraphes. */
function asText(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return v.map(asText).filter(Boolean).join("\n\n");
  if (typeof v === "object") return Object.values(v as Record<string, unknown>).map(asText).filter(Boolean).join("\n\n");
  return String(v);
}

function block(title: string, body: unknown): string {
  const t = asText(body).trim();
  if (!t) return "";
  const isHtml = /<\/?(p|ul|li|br|strong|em|h\d)\b/i.test(t);
  const inner = isHtml
    ? t
    : t.split(/\n{2,}/).map((p) => `<p>${esc(p).replace(/\n/g, "<br>")}</p>`).join("");
  return `<h2>${esc(title)}</h2>${inner}`;
}

function salaryLabel(h: Hit): string | null {
  const min = h.salary_minimum, max = h.salary_maximum;
  if (!min && !max) return null;
  const cur = h.salary_currency || "EUR";
  const per = h.salary_period === "month" ? "/ mois" : h.salary_period === "day" ? "/ jour" : "/ an";
  const range = min && max && min !== max ? `${min}–${max}` : String(min ?? max);
  return `${range} ${cur} ${per}`;
}

function toScraped(h: Hit): ScrapedOffre | null {
  const title = (h.name ?? "").trim();
  const orgSlug = h.organization?.slug ?? "";
  if (!title || !h.slug || !orgSlug) return null;
  const office = h.offices?.[0] ?? null;
  const country =
    normalizeCountryName(office?.country ?? null) ??
    (office?.country_code ? normalizeCountryName(office.country_code) : null);
  const url = `${SITE}/fr/companies/${orgSlug}/jobs/${h.slug}`;
  const description_html = [
    block("Résumé", h.summary),
    block("Missions", h.key_missions),
    block("Profil recherché", h.profile),
    block("Avantages", h.benefits),
  ].join("");
  const description_text = htmlToText(description_html);
  if (description_text.length < 80) return null;
  const rawContract = (h.contract_type ?? "").toLowerCase();
  const contract_type = CONTRACT_LABELS[rawContract] ?? (h.contract_type || null);
  return {
    source_id: h.objectID,
    url,
    title,
    company: (h.organization?.name ?? "").trim(),
    country,
    location: office?.city ?? null,
    contract_type,
    salary: salaryLabel(h),
    description_html,
    description_text,
    description_status: "ok",
    posted_at: h.published_at ? String(h.published_at).slice(0, 10) : null,
    is_vie: rawContract === "vie" || detectVie({ source: SOURCE, title, description: description_text, url }),
    raw_payload: { objectID: h.objectID, slug: h.slug, contract_type: h.contract_type, language: h.language, remote: h.remote },
  };
}

/** Noms de département de l'index qui diffèrent des nôtres (relevés en octobre 2026). */
const INDEX_DISTRICT: Record<string, string> = { "06": "Maritime Alps", "974": "Réunion" };

/**
 * Filtre de lieu de l'index : les départements de la zone (« offices.district »),
 * les offres en télétravail complet, et les offres des autres pays visés — la
 * zone ne vaut que pour la France. Les noms de région de l'index sont
 * irréguliers (« Brittany », « Loire Region ») : une région passe par la liste
 * de ses départements.
 */
export function wttjAreaFilter(area: SearchArea, otherCountryCodes: string[], scope: "zone" | "region" = "zone"): string {
  const regionCode = area.kind === "region" ? area.code : DEPARTEMENTS.find((d) => d.code === area.code)?.region;
  const depts =
    area.kind === "departement" && scope === "zone"
      ? DEPARTEMENTS.filter((d) => d.code === area.code)
      : DEPARTEMENTS.filter((d) => d.region === regionCode);
  const quote = (v: string) => `"${v.replace(/"/g, '\\"')}"`;
  return [
    ...depts.map((d) => `offices.district:${quote(INDEX_DISTRICT[d.code] ?? d.name)}`),
    'remote:"fulltime"',
    ...otherCountryCodes.map((c) => `offices.country_code:${quote(c)}`),
  ].join(" OR ");
}

async function searchPage(query: string, page: number, filters?: string): Promise<{ hits: Hit[]; nbPages: number }> {
  const params = new URLSearchParams({ query, hitsPerPage: String(HITS_PER_PAGE), page: String(page) });
  if (filters) params.set("filters", filters);
  const res = await fetch(ALGOLIA_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-algolia-api-key": ALGOLIA_API_KEY,
      "x-algolia-application-id": ALGOLIA_APP_ID,
      referer: `${SITE}/`,
      origin: SITE,
    },
    body: JSON.stringify({ requests: [{ indexName: INDEX, params: params.toString() }] }),
  });
  if (!res.ok) throw new Error(`WTTJ Algolia HTTP ${res.status}`);
  const data = (await res.json()) as { results?: { hits?: Hit[]; nbPages?: number }[]; message?: string };
  const r = data.results?.[0];
  if (!r) throw new Error(`WTTJ Algolia : réponse inattendue${data.message ? ` (${data.message})` : ""}`);
  return { hits: r.hits ?? [], nbPages: r.nbPages ?? 0 };
}

export const wttjScraper: Scraper = {
  name: SOURCE,
  async *scrape(criteria: ScrapeCriteria, onEvent: (e: ProgressEvent) => void) {
    onEvent({ kind: "start", source: SOURCE });
    const max = criteria.maxOffres ?? 200;
    const targetCodes = new Set(
      criteria.countries.map((c) => nameToCode(c)).filter((c): c is string => !!c)
    );
    const queries = criteria.queries.length ? criteria.queries : [""];
    const quota = quotaPerQuery(max, queries.length);
    const inCountries = (h: Hit) => {
      if (!targetCodes.size) return true;
      const codes = (h.offices ?? []).map((o) => (o.country_code ?? "").toUpperCase()).filter(Boolean);
      if (!codes.length) return true; // lieu inconnu : on laisse le scoring décider
      return codes.some((c) => targetCodes.has(c));
    };

    // 1. Collecte via l'index : une recherche par poste visé, 2 pages max. Chaque
    //    requête garde sa part, ses offres les plus récentes d'abord : un tri par
    //    date sur l'ensemble laissait une requête très active évincer les autres.
    //    Zone : filtre sur les départements de l'index. Sans lui, les offres de
    //    tout le pays remplissaient la part (une infirmière de Lyon recevait
    //    Cherbourg et Colmar). Un département trop maigre s'élargit à sa région.
    const otherCodes = [...targetCodes].filter((c) => c !== "FR");
    const scopes: (string | undefined)[] = criteria.area
      ? [wttjAreaFilter(criteria.area, otherCodes), ...(criteria.area.kind === "departement" ? [wttjAreaFilter(criteria.area, otherCodes, "region")] : [])]
      : [undefined];
    const seen = new Set<string>();
    const picked: Hit[] = [];
    let apiError: string | null = null;
    for (const q of queries) {
      const own: Hit[] = [];
      const ownIds = new Set<string>();
      // Rang de la portée : le département passe avant sa région élargie.
      const scopeOf = new Map<string, number>();
      for (const [scopeIndex, filters] of scopes.entries()) {
        if (own.length >= quota) break;
        for (let page = 0; page < PAGES_PER_QUERY; page++) {
          try {
            const { hits, nbPages } = await searchPage(q, page, filters);
            for (const h of hits) {
              if (h?.objectID && !seen.has(h.objectID) && !ownIds.has(h.objectID) && inCountries(h)) {
                own.push(h);
                ownIds.add(h.objectID);
                scopeOf.set(h.objectID, scopeIndex);
              }
            }
            if (page + 1 >= nbPages) break;
          } catch (e) {
            apiError = e instanceof Error ? e.message : String(e);
            break;
          }
        }
        if (apiError) break;
      }
      own.sort(
        (a, b) =>
          (scopeOf.get(a.objectID) ?? 0) - (scopeOf.get(b.objectID) ?? 0) ||
          (b.published_at ?? "").localeCompare(a.published_at ?? "")
      );
      for (const h of own.slice(0, quota)) {
        seen.add(h.objectID);
        picked.push(h);
      }
      if (apiError) break;
    }
    if (apiError && picked.length === 0) throw new Error(apiError);
    onEvent({ kind: "list", source: SOURCE, total: picked.length });

    // 3. Conversion — aucune requête réseau supplémentaire.
    let ok = 0;
    let failed = 0;
    for (let i = 0; i < picked.length; i++) {
      const offre = toScraped(picked[i]);
      if (offre) {
        yield offre;
        ok++;
        onEvent({ kind: "offre", source: SOURCE, index: i + 1, total: picked.length, status: "ok" });
      } else {
        failed++;
        onEvent({ kind: "offre", source: SOURCE, index: i + 1, total: picked.length, status: "failed" });
      }
    }
    onEvent({ kind: "done", source: SOURCE, seen: picked.length, ok, failed });
  },
};
