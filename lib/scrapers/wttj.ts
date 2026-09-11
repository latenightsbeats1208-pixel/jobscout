import "server-only";
import type { Scraper, ScrapedOffre, ScrapeCriteria, ProgressEvent } from "./base";
import { htmlToText } from "./base";
import { detectVie } from "@/lib/vie";
import { normalizeCountryName, nameToCode } from "@/lib/countries";

/**
 * Welcome to the Jungle via son index de recherche public (Algolia) — le même
 * que celui du site. Historique : le scraping des fiches HTML (sitemap +
 * JSON-LD) est bloqué depuis l'été 2026 par un défi AWS WAF (HTTP 202 +
 * JavaScript obligatoire) dès la 3ᵉ requête : 7 réussites, 14 échecs, scan
 * coupé à chaque fois. L'index Algolia expose les champs utiles (résumé,
 * missions, profil, contrat, lieu, date, salaire) sans aucune page HTML.
 * Clé de recherche publique embarquée dans le front WTTJ (lecture seule).
 */
const SOURCE = "wttj";
const ALGOLIA_URL = "https://csekhvms53-dsn.algolia.net/1/indexes/*/queries";
const ALGOLIA_APP_ID = process.env.WTTJ_ALGOLIA_APP || "CSEKHVMS53";
const ALGOLIA_API_KEY = process.env.WTTJ_ALGOLIA_KEY || "4bd8f6215d0cc52b26430765769e65a0";
const INDEX = "wttj_jobs_production_fr";
const SITE = "https://www.welcometothejungle.com";
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

async function searchPage(query: string, page: number): Promise<{ hits: Hit[]; nbPages: number }> {
  const params = new URLSearchParams({ query, hitsPerPage: String(HITS_PER_PAGE), page: String(page) });
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
    const queries = criteria.sectors.length ? criteria.sectors : ["chef de projet"];

    // 1. Collecte via l'index : une recherche par secteur cible, 2 pages max.
    const seen = new Map<string, Hit>();
    let apiError: string | null = null;
    for (const q of queries) {
      for (let page = 0; page < PAGES_PER_QUERY; page++) {
        try {
          const { hits, nbPages } = await searchPage(q, page);
          for (const h of hits) if (h?.objectID && !seen.has(h.objectID)) seen.set(h.objectID, h);
          if (page + 1 >= nbPages) break;
        } catch (e) {
          apiError = e instanceof Error ? e.message : String(e);
          break;
        }
      }
      if (apiError) break;
    }
    if (apiError && seen.size === 0) throw new Error(apiError);

    // 2. Filtre pays (si des pays cibles sont définis) + tri par date de publication.
    const filtered = Array.from(seen.values()).filter((h) => {
      if (!targetCodes.size) return true;
      const codes = (h.offices ?? []).map((o) => (o.country_code ?? "").toUpperCase()).filter(Boolean);
      if (!codes.length) return true; // lieu inconnu : on laisse le scoring décider
      return codes.some((c) => targetCodes.has(c));
    });
    filtered.sort((a, b) => (b.published_at ?? "").localeCompare(a.published_at ?? ""));
    const picked = filtered.slice(0, max);
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
