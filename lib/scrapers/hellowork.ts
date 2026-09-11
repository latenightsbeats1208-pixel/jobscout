import "server-only";
import type { Scraper, ScrapedOffre, ScrapeCriteria, ProgressEvent } from "./base";
import { htmlToText } from "./base";
import { detectVie } from "@/lib/vie";
import {
  parseDocument,
  firstMatchHtml,
  largestTextBlockHtml,
  extractJobPostingLd,
  BROWSER_HEADERS,
  sleep,
} from "./dom";

const SOURCE = "hellowork";
const SEARCH_URL = "https://www.hellowork.com/fr-fr/emploi/recherche.html";

// Structure HTML (vérifiée avril 2026) :
// - Cartes repérables via <input name="offerId" value="...">
// - <h3> contient "Titre\nEntreprise"
// - Détail : /fr-fr/emplois/{id}.html — description dans [itemprop=description] & co
const DETAIL_SELECTORS = [
  '[itemprop="description"]',
  '[data-testid="offer-description"]',
  ".offer-description",
  "section.job-description",
  "article",
  ".tw-typo-long-m",
];

type Card = {
  id: string;
  url: string;
  title: string;
  company: string;
  location: string | null;
  contract: string | null;
  salary: string | null;
};

function parseSearchPage(html: string): Card[] {
  const doc = parseDocument(html);
  const cards: Card[] = [];
  const seen = new Set<string>();

  for (const inp of Array.from(doc.querySelectorAll('input[name="offerId"]'))) {
    const id = inp.getAttribute("value") ?? "";
    if (!id || seen.has(id)) continue;

    // Remonter jusqu'au conteneur de carte (celui qui contient un h3)
    let card: Element | null = inp.parentElement;
    for (let i = 0; i < 10 && card; i++) {
      if (card.querySelector("h3")) break;
      card = card.parentElement;
    }
    if (!card) continue;

    const h3 = card.querySelector("h3");
    if (!h3) continue;
    const h3Lines = (h3.textContent ?? "")
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    const title = h3Lines[0] ?? "";
    const company = h3Lines[1] ?? "";
    if (!title) continue;

    let url = h3.closest("a")?.getAttribute("href") ?? "";
    if (url.startsWith("/")) url = `https://www.hellowork.com${url}`;
    if (!url) url = `https://www.hellowork.com/fr-fr/emplois/${id}.html`;

    let location: string | null = null;
    let contract: string | null = null;
    let salary: string | null = null;
    const lines = (card.textContent ?? "")
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    for (const line of lines) {
      if (!location && /^.+ - \d{2,3}$/.test(line)) location = line.split(" - ")[0].trim();
      else if (!contract && ["CDI", "CDD", "Alternance", "Stage", "Freelance", "Intérim", "Interim", "VIE"].includes(line)) contract = line;
      else if (!salary && line.includes("€")) salary = line;
    }

    seen.add(id);
    cards.push({ id, url, title, company, location, contract, salary });
  }
  return cards;
}

async function fetchSearchPage(keywords: string, page: number): Promise<Card[]> {
  const params = new URLSearchParams({ k: keywords, l: "France" });
  if (page > 1) params.set("p", String(page));
  const res = await fetch(`${SEARCH_URL}?${params}`, { headers: BROWSER_HEADERS });
  if (!res.ok) throw new Error(`HelloWork HTTP ${res.status}`);
  return parseSearchPage(await res.text());
}

async function fetchDetail(card: Card): Promise<ScrapedOffre> {
  let descHtml: string | null = null;
  let ldTitle: string | null = null;
  let ldCompany: string | null = null;
  let ldContract: string | null = null;
  let ldPosted: string | null = null;
  try {
    const res = await fetch(card.url, { headers: BROWSER_HEADERS });
    if (res.ok) {
      const doc = parseDocument(await res.text());
      // Stratégie 1 : JSON-LD JobPosting (propre, structuré)
      const ld = extractJobPostingLd(doc);
      if (ld?.description_html) {
        descHtml = ld.description_html;
        ldTitle = ld.title;
        ldCompany = ld.company;
        ldContract = ld.contract_type;
        ldPosted = ld.posted_at;
      } else {
        // Stratégie 2 : sélecteurs CSS
        descHtml = firstMatchHtml(doc, DETAIL_SELECTORS, 200) ?? largestTextBlockHtml(doc, 300);
      }
    }
  } catch {
    // description indisponible — statut failed ci-dessous
  }

  const description_html = descHtml ?? "";
  const description_text = descHtml ? htmlToText(descHtml) : "";
  const title = card.title || ldTitle || "Offre HelloWork";
  return {
    source_id: card.id,
    url: card.url,
    title,
    company: card.company || ldCompany || "",
    country: "France",
    location: card.location,
    contract_type: card.contract || ldContract,
    salary: card.salary,
    description_html,
    description_text,
    description_status: description_text.length >= 100 ? "ok" : "failed",
    posted_at: ldPosted ? String(ldPosted).slice(0, 10) : null,
    is_vie: detectVie({ source: SOURCE, title, description: description_text, url: card.url }),
    raw_payload: { offerId: card.id },
    scrape_errors: description_text.length >= 100 ? undefined : "description introuvable",
  };
}

export const helloworkScraper: Scraper = {
  name: SOURCE,
  async *scrape(criteria: ScrapeCriteria, onEvent: (e: ProgressEvent) => void) {
    onEvent({ kind: "start", source: SOURCE });

    const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
    const wantsFrance =
      !criteria.countries.length || criteria.countries.some((c) => norm(c) === "france");
    if (!wantsFrance) {
      onEvent({ kind: "list", source: SOURCE, total: 0 });
      onEvent({ kind: "done", source: SOURCE, seen: 0, ok: 0, failed: 0 });
      return;
    }

    const max = criteria.maxOffres ?? 50;
    const queries = criteria.sectors.length ? criteria.sectors : ["chef de projet"];
    const seen = new Map<string, Card>();

    for (const q of queries) {
      for (let page = 1; page <= 3 && seen.size < max; page++) {
        try {
          const cards = await fetchSearchPage(q, page);
          if (!cards.length) break;
          for (const c of cards) if (!seen.has(c.id)) seen.set(c.id, c);
          if (cards.length < 10) break;
          await sleep(1200);
        } catch {
          break;
        }
      }
      if (seen.size >= max) break;
    }

    const cards = Array.from(seen.values()).slice(0, max);
    onEvent({ kind: "list", source: SOURCE, total: cards.length });

    let ok = 0;
    let failed = 0;
    let consecutiveFails = 0;
    for (let i = 0; i < cards.length; i++) {
      try {
        const offre = await fetchDetail(cards[i]);
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
        if (consecutiveFails >= 10) break; // probable rate-limit / changement de structure
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
