import "server-only";
import type { Scraper, ScrapedOffre, ScrapeCriteria, ProgressEvent } from "./base";
import { htmlToText } from "./base";
import { detectVie } from "@/lib/vie";
import { nameToCode } from "@/lib/countries";
import {
  parseDocument,
  firstMatchHtml,
  largestTextBlockHtml,
  extractJobPostingLd,
  BROWSER_HEADERS,
  sleep,
} from "./dom";

const SOURCE = "talent";

// Talent.com a un sous-domaine par pays, avec le même markup SSR.
// Tous vérifiés fonctionnels (août 2026). Couverture francophonie + Amérique du Nord.
const DOMAINS: { host: string; country: string; codes: string[] }[] = [
  { host: "fr.talent.com", country: "France", codes: ["FR"] },
  { host: "be.talent.com", country: "Belgique", codes: ["BE"] },
  { host: "ch.talent.com", country: "Suisse", codes: ["CH"] },
  { host: "lu.talent.com", country: "Luxembourg", codes: ["LU"] },
  { host: "ca.talent.com", country: "Canada", codes: ["CA"] },
  { host: "www.talent.com", country: "États-Unis", codes: ["US"] },
  { host: "ma.talent.com", country: "Maroc", codes: ["MA"] },
  { host: "tn.talent.com", country: "Tunisie", codes: ["TN"] },
  { host: "sn.talent.com", country: "Sénégal", codes: ["SN"] },
];

// Structure (vérifiée avril 2026) : Next.js SSR.
// - Carte : div[data-testid^="jobcard-container-"] avec data-job-id
// - h2 = titre, p = entreprise/lieu, spans = type de contrat
// - Détail : https://fr.talent.com/view?id={job-id}
// Les classes CSS sont hashées par build → on matche par substring.
const DETAIL_SELECTORS = [
  '[class*="jobDescriptionColumn"]',
  '[class*="jobDescription"]',
  '[class*="JobDescription"]',
  '[data-testid="job-description"]',
  "#job-description",
  ".job-description",
  '[itemprop="description"]',
  "article",
];

type Domain = (typeof DOMAINS)[number];

type Card = {
  id: string;
  url: string;
  title: string;
  company: string;
  city: string | null;
  country: string;
  contract: string | null;
  snippet: string;
};

function parseSearchPage(html: string, domain: Domain): Card[] {
  const doc = parseDocument(html);
  const out: Card[] = [];
  for (const container of Array.from(doc.querySelectorAll('[data-testid^="jobcard-container-"]'))) {
    const id = container.getAttribute("data-job-id") ?? "";
    if (!id) continue;
    const card =
      container.querySelector('[data-testid="job-card-server"]') ||
      container.querySelector('[data-testid="job-card-unified"]') ||
      container.querySelector("article") ||
      container;

    const title = card.querySelector("h2")?.textContent?.trim() ?? "";
    if (!title) continue;

    const header = card.querySelector("header") ?? card;
    // Entreprise + lieu : les <p> courts (hors description longue) juste après le titre.
    const shortPs = Array.from(header.querySelectorAll("p"))
      .map((p) => p.textContent?.trim() ?? "")
      .filter((t) => t.length > 0 && t.length < 80 && !/voir plus|quick apply/i.test(t));
    let company = shortPs[0] ?? "";
    let location = shortPs[1] ?? "";
    // Certaines cartes concatènent "Entreprise • Ville, PAYS" dans un seul élément
    if (!location && company.includes("•")) {
      const parts = company.split("•").map((s) => s.trim());
      company = parts[0] ?? "";
      location = parts[1] ?? "";
    }

    let contract: string | null = null;
    for (const span of Array.from(header.querySelectorAll("div div span"))) {
      const t = span.textContent?.trim() ?? "";
      if (t && !["Quick Apply", "Voir plus"].includes(t)) {
        contract = t;
        break;
      }
    }

    let snippet = "";
    for (const p of Array.from(header.querySelectorAll("p"))) {
      const t = p.textContent?.trim() ?? "";
      if (t.length > 50 && !t.slice(0, 20).includes("Voir plus")) {
        snippet = t.replace(/\.{3}Voir plus$/, "...");
        break;
      }
    }

    const city = location ? location.split(",")[0].trim() : null;
    out.push({
      id,
      url: `https://${domain.host}/view?id=${id}`,
      title,
      company,
      city,
      country: domain.country,
      contract,
      snippet,
    });
  }
  return out;
}

async function fetchSearchPage(domain: Domain, keywords: string, page: number): Promise<Card[]> {
  const params = new URLSearchParams({ k: keywords, l: "" });
  if (page > 1) params.set("p", String(page));
  const res = await fetch(`https://${domain.host}/jobs?${params}`, { headers: BROWSER_HEADERS });
  if (!res.ok) throw new Error(`Talent.com ${domain.host} HTTP ${res.status}`);
  return parseSearchPage(await res.text(), domain);
}

async function enrich(card: Card): Promise<ScrapedOffre> {
  let descHtml: string | null = null;
  let ldCompany: string | null = null;
  let ldPosted: string | null = null;
  try {
    const res = await fetch(card.url, { headers: BROWSER_HEADERS });
    if (res.ok) {
      const doc = parseDocument(await res.text());
      const ld = extractJobPostingLd(doc);
      if (ld?.description_html) {
        descHtml = ld.description_html;
        ldCompany = ld.company;
        ldPosted = ld.posted_at;
      } else {
        descHtml = firstMatchHtml(doc, DETAIL_SELECTORS, 200) ?? largestTextBlockHtml(doc, 300);
      }
    }
  } catch {
    // détail indisponible — fallback snippet
  }

  // Le snippet de recherche est propre : on l'utilise si le détail est vide/court.
  const detailText = descHtml ? htmlToText(descHtml) : "";
  const useSnippet = detailText.length < 120 && card.snippet.length > detailText.length;
  const description_html = useSnippet
    ? `<p>${card.snippet}</p>`
    : descHtml ?? (card.snippet ? `<p>${card.snippet}</p>` : "");
  const description_text = useSnippet ? card.snippet : detailText || card.snippet;
  const okStatus = description_text.length >= 100;
  return {
    source_id: card.id,
    url: card.url,
    title: card.title,
    company: card.company || ldCompany || "",
    country: card.country,
    location: card.city,
    contract_type: card.contract,
    salary: null,
    description_html,
    description_text,
    description_status: okStatus ? "ok" : "failed",
    posted_at: ldPosted ? String(ldPosted).slice(0, 10) : null,
    is_vie: detectVie({ source: SOURCE, title: card.title, description: description_text, url: card.url }),
    raw_payload: { id: card.id },
    scrape_errors: okStatus ? undefined : "description introuvable",
  };
}

export const talentScraper: Scraper = {
  name: SOURCE,
  async *scrape(criteria: ScrapeCriteria, onEvent: (e: ProgressEvent) => void) {
    onEvent({ kind: "start", source: SOURCE });

    // Sélection des domaines Talent selon les pays cibles du profil.
    const targetCodes = new Set(
      criteria.countries.map((c) => nameToCode(c)).filter((c): c is string => !!c)
    );
    const activeDomains = targetCodes.size
      ? DOMAINS.filter((d) => d.codes.some((c) => targetCodes.has(c)))
      : [DOMAINS[0]]; // aucun pays ciblé → France par défaut
    if (!activeDomains.length) {
      onEvent({ kind: "list", source: SOURCE, total: 0 });
      onEvent({ kind: "done", source: SOURCE, seen: 0, ok: 0, failed: 0 });
      return;
    }

    // Budget réparti : ~20 offres par pays, borné par maxOffres global.
    const max = criteria.maxOffres ?? Math.min(150, activeDomains.length * 20);
    const perDomain = Math.max(10, Math.floor(max / activeDomains.length));
    const queries = criteria.sectors.length ? criteria.sectors : ["marketing digital"];
    const seen = new Map<string, Card>();

    for (const domain of activeDomains) {
      let domainCount = 0;
      for (const q of queries) {
        for (let page = 1; page <= 2 && domainCount < perDomain; page++) {
          try {
            const cards = await fetchSearchPage(domain, q, page);
            if (!cards.length) break;
            for (const c of cards) {
              if (!seen.has(c.id) && domainCount < perDomain) {
                seen.set(c.id, c);
                domainCount++;
              }
            }
            if (cards.length < 10) break;
            await sleep(1000);
          } catch {
            break;
          }
        }
        if (domainCount >= perDomain) break;
      }
    }

    const cards = Array.from(seen.values()).slice(0, max);
    onEvent({ kind: "list", source: SOURCE, total: cards.length });

    let ok = 0;
    let failed = 0;
    let consecutiveFails = 0;
    for (let i = 0; i < cards.length; i++) {
      try {
        const offre = await enrich(cards[i]);
        yield offre;
        if (offre.description_status === "ok") {
          ok++;
          consecutiveFails = 0;
        } else {
          failed++;
          consecutiveFails++;
        }
        onEvent({
          kind: "offre",
          source: SOURCE,
          index: i + 1,
          total: cards.length,
          status: offre.description_status === "ok" ? "ok" : "failed",
        });
        if (consecutiveFails >= 10) break;
        await sleep(800 + Math.random() * 700);
      } catch {
        failed++;
        consecutiveFails++;
        onEvent({ kind: "offre", source: SOURCE, index: i + 1, total: cards.length, status: "failed" });
        if (consecutiveFails >= 10) break;
      }
    }
    onEvent({ kind: "done", source: SOURCE, seen: cards.length, ok, failed });
  },
};
