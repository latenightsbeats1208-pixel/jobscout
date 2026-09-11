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

const SOURCE = "francetravail";

// Stratégie 1 : API officielle v2 (si FT_CLIENT_ID / FT_CLIENT_SECRET fournis)
// Stratégie 2 : scraping HTML de candidat.francetravail.fr (server-rendered)
const API_BASE = "https://api.francetravail.io/partenaire/offresdemploi/v2";
const TOKEN_URL =
  "https://entreprise.francetravail.fr/connexion/oauth2/access_token?realm=/partenaire";
const SEARCH_PAGE = "https://candidat.francetravail.fr/offres/recherche";

const DETAIL_SELECTORS = [
  '[itemprop="description"]',
  '[data-test="offre-detail"]',
  "#description-libelle",
  "section.description-offre",
  ".media-body",
  "article",
];

let cachedToken: { token: string; expires: number } | null = null;

async function getToken(): Promise<string | null> {
  const id = process.env.FT_CLIENT_ID;
  const secret = process.env.FT_CLIENT_SECRET;
  if (!id || !secret) return null;
  if (cachedToken && cachedToken.expires > Date.now()) return cachedToken.token;
  try {
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: id,
        client_secret: secret,
        scope: "api_offresdemploiv2 o2dsoffre",
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    cachedToken = {
      token: data.access_token,
      expires: Date.now() + (data.expires_in ?? 1500) * 1000 - 60000,
    };
    return cachedToken.token;
  } catch {
    return null;
  }
}

type FtApiJob = {
  id?: string;
  intitule?: string;
  description?: string;
  entreprise?: { nom?: string };
  lieuTravail?: { libelle?: string };
  typeContratLibelle?: string;
  typeContrat?: string;
  salaire?: { libelle?: string };
  dateCreation?: string;
  dateActualisation?: string;
  origineOffre?: { urlOrigine?: string };
  competences?: { libelle?: string }[];
};

function apiJobToScraped(job: FtApiJob): ScrapedOffre | null {
  const id = String(job.id ?? "");
  const title = (job.intitule ?? "").trim();
  const description = (job.description ?? "").trim();
  if (!id || !title || !description) return null;

  let city = job.lieuTravail?.libelle ?? "";
  if (city.includes(" - ")) city = city.split(" - ").slice(1).join(" - ").trim();

  const url =
    job.origineOffre?.urlOrigine ||
    `https://candidat.francetravail.fr/offres/recherche/detail/${id}`;

  const skills = (job.competences ?? [])
    .map((c) => c.libelle)
    .filter(Boolean)
    .join(", ");
  const fullText = skills ? `${description}\n\nCompétences : ${skills}` : description;

  return {
    source_id: id,
    url,
    title,
    company: job.entreprise?.nom?.trim() ?? "",
    country: "France",
    location: city || null,
    contract_type: job.typeContratLibelle ?? job.typeContrat ?? null,
    salary: job.salaire?.libelle ?? null,
    description_html: fullText
      .split(/\n\n+/)
      .map((p) => `<p>${p.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/\n/g, "<br>")}</p>`)
      .join(""),
    description_text: fullText,
    description_status: "ok",
    posted_at: (job.dateCreation ?? job.dateActualisation ?? "").slice(0, 10) || null,
    is_vie: detectVie({ source: SOURCE, title, description: fullText, url }),
    raw_payload: { id, typeContrat: job.typeContrat },
  };
}

async function fetchApi(keywords: string, start: number, size: number): Promise<FtApiJob[]> {
  const token = await getToken();
  if (!token) return [];
  const params = new URLSearchParams({
    motsCles: keywords,
    range: `${start}-${start + size - 1}`,
  });
  const res = await fetch(`${API_BASE}/offres/search?${params}`, {
    headers: { accept: "application/json", authorization: `Bearer ${token}` },
  });
  if (!res.ok) return [];
  const data = await res.json();
  return (data.resultats ?? []) as FtApiJob[];
}

type HtmlCard = {
  id: string;
  title: string;
  company: string;
  city: string | null;
  contract: string | null;
  snippet: string;
};

function parseHtmlSearch(html: string): HtmlCard[] {
  const doc = parseDocument(html);
  const out: HtmlCard[] = [];
  for (const li of Array.from(doc.querySelectorAll("li[data-id-offre]"))) {
    const id = li.getAttribute("data-id-offre") ?? "";
    if (!id) continue;
    const title = li.querySelector("h2, .t4")?.textContent?.trim() ?? "";
    if (!title) continue;

    let company = "";
    let city: string | null = null;
    // Normalise espaces insécables + retours à la ligne avant de découper "COMPANY - DEPT - CITY"
    const sub = (li.querySelector("p.subtext, .subtext")?.textContent ?? "")
      .replace(/ /g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (sub) {
      const parts = sub.split(/\s+-\s+/).map((p) => p.trim()).filter(Boolean);
      company = parts[0] ?? "";
      city = parts.length >= 3 ? parts[2] : parts[1] ?? null;
      // Si le "lieu" n'est qu'un code département (2-3 chiffres), on le garde comme ville seulement s'il n'y a rien de mieux
      if (city && /^\d{2,3}$/.test(city) && parts.length >= 3) city = parts[2];
    }

    const dd = li.querySelector("dd")?.textContent?.trim() ?? "";
    const contract = dd ? dd.split(" - ")[0].trim() : null;

    const snippet = Array.from(li.querySelectorAll("p"))
      .filter((p) => !(p.getAttribute("class") ?? "").includes("subtext"))
      .map((p) => p.textContent?.trim() ?? "")
      .filter((t) => t.length > 20)
      .join(" ");

    out.push({ id, title, company, city, contract, snippet });
  }
  return out;
}

async function fetchHtmlPage(keywords: string, page: number): Promise<HtmlCard[]> {
  const params = new URLSearchParams({
    motsCles: keywords,
    offresPartenaires: "true",
    page: String(page),
  });
  const res = await fetch(`${SEARCH_PAGE}?${params}`, { headers: BROWSER_HEADERS });
  if (!res.ok) throw new Error(`France Travail HTTP ${res.status}`);
  return parseHtmlSearch(await res.text());
}

async function enrichCard(card: HtmlCard): Promise<ScrapedOffre> {
  const url = `https://candidat.francetravail.fr/offres/recherche/detail/${card.id}`;
  let descHtml: string | null = null;
  try {
    const res = await fetch(url, { headers: BROWSER_HEADERS });
    if (res.ok) {
      const doc = parseDocument(await res.text());
      const ld = extractJobPostingLd(doc);
      descHtml =
        ld?.description_html ||
        firstMatchHtml(doc, DETAIL_SELECTORS, 200) ||
        largestTextBlockHtml(doc, 300);
    }
  } catch {
    // détail indisponible — on retombe sur le snippet
  }

  const description_html = descHtml ?? (card.snippet ? `<p>${card.snippet}</p>` : "");
  const description_text = descHtml ? htmlToText(descHtml) : card.snippet;
  const okStatus = description_text.length >= 100;
  return {
    source_id: card.id,
    url,
    title: card.title,
    company: card.company,
    country: "France",
    location: card.city,
    contract_type: card.contract,
    salary: null,
    description_html,
    description_text,
    description_status: okStatus ? "ok" : "failed",
    posted_at: null,
    is_vie: detectVie({ source: SOURCE, title: card.title, description: description_text, url }),
    raw_payload: { id: card.id },
    scrape_errors: okStatus ? undefined : "description introuvable",
  };
}

export const francetravailScraper: Scraper = {
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

    // Stratégie 1 : API officielle (descriptions complètes, aucun fetch détail nécessaire)
    const apiOffres = new Map<string, ScrapedOffre>();
    for (const q of queries) {
      let start = 0;
      while (apiOffres.size < max && start < 150) {
        const jobs = await fetchApi(q, start, 50);
        if (!jobs.length) break;
        for (const j of jobs) {
          const o = apiJobToScraped(j);
          if (o && !apiOffres.has(o.source_id)) apiOffres.set(o.source_id, o);
        }
        if (jobs.length < 50) break;
        start += 50;
        await sleep(400);
      }
      if (apiOffres.size >= max) break;
    }

    if (apiOffres.size > 0) {
      const list = Array.from(apiOffres.values()).slice(0, max);
      onEvent({ kind: "list", source: SOURCE, total: list.length });
      let ok = 0;
      for (let i = 0; i < list.length; i++) {
        yield list[i];
        ok++;
        onEvent({ kind: "offre", source: SOURCE, index: i + 1, total: list.length, status: "ok" });
      }
      onEvent({ kind: "done", source: SOURCE, seen: list.length, ok, failed: 0 });
      return;
    }

    // Stratégie 2 : HTML fallback
    const seen = new Map<string, HtmlCard>();
    for (const q of queries) {
      for (let page = 1; page <= 3 && seen.size < max; page++) {
        try {
          const cards = await fetchHtmlPage(q, page);
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
        const offre = await enrichCard(cards[i]);
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
        await sleep(900 + Math.random() * 600);
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
