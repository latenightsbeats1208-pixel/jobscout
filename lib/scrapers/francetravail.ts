import type { SearchArea } from "@/lib/geo/fr";
import { quotaPerQuery } from "@/lib/scan/search-plan";
import "server-only";
import type { Scraper, ScrapedOffre, ScrapeCriteria, ProgressEvent } from "./base";
import { htmlToText } from "./base";
import { detectVie } from "@/lib/vie";
import {
  parseDocument,
  firstMatchHtml,
  extractJobPostingLd,
  BROWSER_HEADERS,
  sleep,
} from "./dom";

const SOURCE = "francetravail";

// Stratégie 1 : API officielle v2 (si FT_CLIENT_ID / FT_CLIENT_SECRET fournis)
// Stratégie 2 : liste HTML de candidat.francetravail.fr (server-rendered), puis
// description de chaque offre lue dans le JSON public du site.
const API_BASE = "https://api.francetravail.io/partenaire/offresdemploi/v2";
const TOKEN_URL =
  "https://entreprise.francetravail.fr/connexion/oauth2/access_token?realm=/partenaire";
const SEARCH_PAGE = "https://candidat.francetravail.fr/offres/recherche";
/** Page métier × lieu vers laquelle le site redirige une recherche courante (« /offres/emploi/acheteur/finistere/s11m14d29 »). */
const LANDING_PATH = /^\/offres\/emploi\//;
const DETAIL_PAGE = "https://candidat.francetravail.fr/offres/recherche/detail";
// La page de détail n'embarque plus la description : le composant
// <descriptif-offre> la charge dans le navigateur depuis ce JSON (sans clé ;
// 204 pour une offre inconnue ou retirée). Le HTML seul ne contient que les
// cartes « D'autres offres peuvent vous intéresser » et l'aide de la recherche.
const DESCRIPTIF_JSON = "https://candidat.francetravail.fr/api-descriptifoffre/offre";

// Conteneurs propres à la description de l'offre affichée. Jamais de conteneur
// générique (.media-body, article, plus grand bloc de texte) : sur la page de
// détail, ils désignent les cartes des offres voisines ou l'aide de la recherche.
const DETAIL_SELECTORS = [
  '[itemprop="description"]',
  "descriptif-offre",
  "#description-libelle",
  "section.description-offre",
];

// Parties de la page de détail qui décrivent d'autres offres ou la recherche.
const FOREIGN_BLOCKS = ".block-other-offers, li[data-id-offre], .modal-help";

// Texte de la liste de résultats (ou de son aide), jamais celui d'une offre.
const RESULTS_PAGE_MARKERS = [
  "la liste des offres d'emploi est restituee par ordre de pertinence",
  "d'autres offres peuvent vous interesser",
  "visualiser les resultats de votre recherche",
];

const norm = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/’/g, "'").replace(/\s+/g, " ");

const DEPARTEMENT_CODE = /^(?:\d{2,3}|2[AB])$/i;

const MOIS = ["janvier", "fevrier", "mars", "avril", "mai", "juin", "juillet", "aout", "septembre", "octobre", "novembre", "decembre"];

/** « 24 septembre 2026 », « 1er octobre 2026 » → « 2026-09-24 » ; null si illisible. */
export function parseFrenchDate(raw: string | null | undefined): string | null {
  const m = norm(raw ?? "").match(/(\d{1,2})(?:er)?\s+([a-z]+)\s+(\d{4})/);
  if (!m) return null;
  const month = MOIS.indexOf(m[2]) + 1;
  const day = Number(m[1]);
  if (!month || day < 1 || day > 31) return null;
  return `${m[3]}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * « Publié il y a 3 jours », « Publié hier », « Publié aujourd'hui » (carte de
 * la liste) → date ISO ; null pour « plus de 30 jours » ou un texte inconnu.
 */
export function parsePublishedAgo(raw: string | null | undefined, now = new Date()): string | null {
  const t = norm(raw ?? "");
  const days = /aujourd'hui/.test(t) ? 0 : /\bhier\b/.test(t) ? 1 : /plus de/.test(t) ? null : Number(t.match(/il y a (\d+) jours?/)?.[1] ?? NaN);
  if (days === null || Number.isNaN(days)) return null;
  return new Date(now.getTime() - days * 86_400_000).toISOString().slice(0, 10);
}

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

function textToHtml(text: string): string {
  return text
    .split(/\n\n+/)
    .map((p) => `<p>${p.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/\n/g, "<br>")}</p>`)
    .join("");
}

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
    description_html: textToHtml(fullText),
    description_text: fullText,
    description_status: "ok",
    posted_at: (job.dateCreation ?? job.dateActualisation ?? "").slice(0, 10) || null,
    is_vie: detectVie({ source: SOURCE, title, description: fullText, url }),
    raw_payload: { id, typeContrat: job.typeContrat },
  };
}

async function fetchApi(keywords: string, start: number, size: number, area?: SearchArea | null): Promise<FtApiJob[]> {
  const token = await getToken();
  if (!token) return [];
  const params = new URLSearchParams({
    motsCles: keywords,
    range: `${start}-${start + size - 1}`,
  });
  if (area) params.set(area.kind === "region" ? "region" : "departement", area.code);
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
  posted_at: string | null;
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
      // Offre anonyme : « 26 - Romans-sur-Isère », sans entreprise devant le département.
      if (parts.length && DEPARTEMENT_CODE.test(parts[0])) parts.unshift("");
      company = parts[0] ?? "";
      city = parts.length >= 3 ? parts[2] : parts[1] ?? null;
      // Si le "lieu" n'est qu'un code département (2-3 chiffres), on le garde comme ville seulement s'il n'y a rien de mieux
      if (city && /^\d{2,3}$/.test(city) && parts.length >= 3) city = parts[2];
    }

    // « <p class="contrat">Intérim<span class="type-contrat">Temps plein</span> » :
    // le premier nœud texte est le contrat (relevé en octobre 2026 ; l'ancien
    // gabarit le rangeait dans un <dd> « CDD - 6 Mois »).
    const contractEl = li.querySelector("p.contrat");
    const contractText = contractEl
      ? Array.from(contractEl.childNodes).find((n) => n.nodeType === 3 && n.textContent?.trim())?.textContent
      : li.querySelector("dd")?.textContent;
    const contract = contractText?.split(" - ")[0].trim() || null;

    const snippet = Array.from(li.querySelectorAll("p"))
      .filter((p) => !/subtext|date|contrat/.test(p.getAttribute("class") ?? ""))
      .map((p) => p.textContent?.trim() ?? "")
      .filter((t) => t.length > 20)
      .join(" ");

    const posted_at = parsePublishedAgo(li.querySelector("p.date")?.textContent);

    out.push({ id, title, company, city, contract, snippet, posted_at });
  }
  return out;
}

const QUERY_STOPWORDS = new Set(["de", "des", "du", "la", "le", "les", "et", "en", "pour", "au", "aux", "un", "une"]);

/**
 * Les mots d'une requête réduits à leur début, pour couvrir le féminin et le
 * pluriel : « Formateur » → « format » (formateur, formatrice).
 */
export function queryStems(query: string): string[] {
  return norm(query)
    .split(/[^a-z0-9+#]+/)
    .filter((w) => w.length >= 2 && !QUERY_STOPWORDS.has(w))
    .map((w) => (w.length > 4 ? w.slice(0, Math.max(4, w.length - 3)) : w));
}

/** La carte (titre et extrait) contient-elle tous les mots de la requête ? */
function matchesQuery(card: HtmlCard, stems: string[]): boolean {
  const text = norm(`${card.title} ${card.snippet}`);
  return stems.every((s) => new RegExp(`(?:^|[^a-z0-9])${s.replace(/[+#.]/g, "\\$&")}`).test(text));
}

/**
 * Une page de résultats. `landing` : le site a redirigé la recherche vers sa
 * page « /offres/emploi/<métier>/<lieu> », qui n'a qu'une page.
 */
async function fetchHtmlPage(keywords: string, page: number, area?: SearchArea | null): Promise<{ cards: HtmlCard[]; landing: boolean }> {
  const params = new URLSearchParams({
    motsCles: keywords,
    offresPartenaires: "true",
    page: String(page),
  });
  // « 69D » : un département, « 84R » : une région (vérifié sur le site, octobre 2026).
  if (area) params.set("lieux", `${area.code}${area.kind === "region" ? "R" : "D"}`);
  const res = await fetch(`${SEARCH_PAGE}?${params}`, { headers: BROWSER_HEADERS });
  // Recherche courante (« Développeur PHP » dans le Finistère, « Acheteur » dans
  // le Finistère) : le site redirige vers sa page métier × lieu, servie en 410
  // mais avec ses 20 premières offres. La rejeter laissait la source à « 0 vue,
  // 0 échec » (audit d'octobre 2026). On la reconnaît à son code et à son
  // adresse, jamais à `res.redirected` : dans l'application, Next recopie chaque
  // réponse de fetch sans cet indicateur, qui y vaut toujours false (recherche
  // « Acheteur » du 19 octobre 2026 : « France Travail HTTP 410 », scan partiel).
  if (res.status === 410 || LANDING_PATH.test(new URL(res.url || SEARCH_PAGE).pathname)) {
    return { cards: parseHtmlSearch(await res.text()), landing: true };
  }
  if (!res.ok) throw new Error(`France Travail HTTP ${res.status}`);
  return { cards: parseHtmlSearch(await res.text()), landing: false };
}

// Description lue pour une offre, ou motif de rejet quand la réponse décrit
// autre chose que l'offre demandée (offre voisine, page de résultats).
type Detail =
  | { html: string; text: string; salary: string | null; posted_at?: string | null; contract?: string | null }
  | { rejected: string };

type FtDescriptif = {
  numeroOffre?: string | null;
  descriptif?: string | null;
  salaire?: string | null;
  listeCompetence?: { libelleCompetence?: string | null }[] | null;
  /** « 24 septembre 2026 » : la date « Actualisé le » du site. */
  dateDerniereModification?: string | null;
  /** « Intérim - 18 Mois - Contrat travail », « CDD - 24 Mois - Contrat apprentissage ». */
  syntheseContrat?: string | null;
};

async function fetchDescriptif(id: string): Promise<Detail | null> {
  try {
    const res = await fetch(`${DESCRIPTIF_JSON}/${encodeURIComponent(id)}`, {
      headers: { ...BROWSER_HEADERS, accept: "application/json" },
    });
    if (res.status !== 200) return null;
    const data = (await res.json()) as FtDescriptif;
    // « Offre n° 215BMQN » : la réponse doit porter sur l'offre demandée.
    if (data.numeroOffre && !data.numeroOffre.includes(id)) {
      return { rejected: `description d'une autre offre (${data.numeroOffre})` };
    }
    const descriptif = (data.descriptif ?? "").trim();
    if (!descriptif) return null;
    const skills = (data.listeCompetence ?? [])
      .map((c) => c.libelleCompetence)
      .filter(Boolean)
      .join(", ");
    const text = skills ? `${descriptif}\n\nCompétences : ${skills}` : descriptif;
    return {
      html: textToHtml(text),
      text,
      salary: data.salaire?.trim() || null,
      posted_at: parseFrenchDate(data.dateDerniereModification),
      // La synthèse dit aussi la nature du contrat, seule trace d'une alternance
      // que la carte affiche « CDD ».
      contract: data.syntheseContrat?.replace(/\s*-\s*Contrat travail\s*$/i, "").trim() || null,
    };
  } catch {
    return null;
  }
}

// Repli : description rendue côté serveur dans la page de détail, si le site
// la remet un jour dans le HTML.
async function fetchDetailPage(url: string, id: string): Promise<Detail | null> {
  try {
    const res = await fetch(url, { headers: BROWSER_HEADERS });
    if (!res.ok) return null;
    // Offre retirée renvoyée vers la recherche : ses cartes sont d'autres offres.
    // L'adresse finale suffit (`res.redirected` est perdu dans l'application, cf. fetchHtmlPage).
    if (res.url && !res.url.includes(`/detail/${id}`)) {
      return { rejected: "page de résultats au lieu du détail de l'offre" };
    }
    const doc = parseDocument(await res.text());
    doc.querySelectorAll(FOREIGN_BLOCKS).forEach((el) => el.remove());
    const html =
      extractJobPostingLd(doc)?.description_html || firstMatchHtml(doc, DETAIL_SELECTORS, 200);
    return html ? { html, text: htmlToText(html), salary: null } : null;
  } catch {
    return null;
  }
}

// Filet de sécurité : carte d'une autre offre ou texte de la page de résultats.
function foreignDescriptionReason(html: string, text: string): string | null {
  if (/data-id-offre|media-heading/.test(html)) return "description d'une autre offre (carte de liste)";
  const t = norm(text);
  if (RESULTS_PAGE_MARKERS.some((m) => t.includes(m))) {
    return "page de résultats au lieu du détail de l'offre";
  }
  return null;
}

async function enrichCard(card: HtmlCard): Promise<ScrapedOffre> {
  const url = `${DETAIL_PAGE}/${card.id}`;
  let detail = (await fetchDescriptif(card.id)) ?? (await fetchDetailPage(url, card.id));
  if (detail && !("rejected" in detail)) {
    const reason = foreignDescriptionReason(detail.html, detail.text);
    if (reason) detail = { rejected: reason };
  }
  const own = detail && !("rejected" in detail) ? detail : null;

  // Détail indisponible ou rejeté : on retombe sur le snippet de la carte,
  // qui est bien celui de cette offre.
  const description_html = own?.html ?? (card.snippet ? `<p>${card.snippet}</p>` : "");
  const description_text = own?.text ?? card.snippet;
  const rejected = detail && "rejected" in detail ? detail.rejected : null;
  const okStatus = !rejected && description_text.length >= 100;
  return {
    source_id: card.id,
    url,
    title: card.title,
    company: card.company,
    country: "France",
    location: card.city,
    contract_type: own?.contract ?? card.contract,
    salary: own?.salary ?? null,
    description_html,
    description_text,
    description_status: okStatus ? "ok" : "failed",
    // Date de publication de la carte, sinon date d'actualisation du JSON.
    posted_at: card.posted_at ?? own?.posted_at ?? null,
    is_vie: detectVie({ source: SOURCE, title: card.title, description: description_text, url }),
    raw_payload: { id: card.id },
    scrape_errors: okStatus ? undefined : rejected ?? "description introuvable",
  };
}

export const francetravailScraper: Scraper = {
  name: SOURCE,
  async *scrape(criteria: ScrapeCriteria, onEvent: (e: ProgressEvent) => void) {
    onEvent({ kind: "start", source: SOURCE });

    const wantsFrance =
      !criteria.countries.length || criteria.countries.some((c) => norm(c) === "france");
    if (!wantsFrance) {
      onEvent({ kind: "list", source: SOURCE, total: 0 });
      onEvent({ kind: "done", source: SOURCE, seen: 0, ok: 0, failed: 0 });
      return;
    }

    const max = criteria.maxOffres ?? 50;
    const queries = criteria.queries.length ? criteria.queries : [""];
    const quota = quotaPerQuery(max, queries.length);

    // Stratégie 1 : API officielle (descriptions complètes, aucun fetch détail nécessaire)
    const apiOffres = new Map<string, ScrapedOffre>();
    for (const q of queries) {
      let start = 0;
      let taken = 0;
      while (taken < quota && start < 150) {
        const jobs = await fetchApi(q, start, 50, criteria.area);
        if (!jobs.length) break;
        for (const j of jobs) {
          const o = apiJobToScraped(j);
          if (o && !apiOffres.has(o.source_id) && taken < quota) {
            apiOffres.set(o.source_id, o);
            taken++;
          }
        }
        if (jobs.length < 50) break;
        start += 50;
        await sleep(400);
      }
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
    const listErrors: string[] = [];
    for (const q of queries) {
      let taken = 0;
      const stems = queryStems(q);
      for (let page = 1; page <= 3 && taken < quota; page++) {
        try {
          const result = await fetchHtmlPage(q, page, criteria.area);
          if (!result.cards.length) break;
          // La page métier × lieu liste tout le métier : « Développeur PHP » dans
          // le Finistère y ramenait vingt postes Java, C# ou JavaScript, qui
          // passaient devant les offres PHP. On n'en garde que ce qui parle de la requête.
          const cards = result.landing ? result.cards.filter((c) => matchesQuery(c, stems)) : result.cards;
          let added = 0;
          for (const c of cards) {
            if (!seen.has(c.id) && taken < quota) {
              seen.set(c.id, c);
              taken++;
              added++;
            }
          }
          // Une page métier × lieu ne se pagine pas : la suivante redonne les mêmes offres.
          if (result.landing || !added || cards.length < 10) break;
          await sleep(1200);
        } catch (e) {
          listErrors.push(e instanceof Error ? e.message : String(e));
          break;
        }
      }
    }
    // Aucune offre et des recherches en erreur : la source a échoué, le bilan
    // du scan doit le dire au lieu d'afficher « 0 vue, 0 échec ».
    if (!seen.size && listErrors.length) throw new Error(listErrors[0]);

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
