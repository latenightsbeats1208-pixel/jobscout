import "server-only";
import type { Scraper, ScrapedOffre, ScrapeCriteria, ProgressEvent } from "./base";
import { detectVie } from "@/lib/vie";
import { parseDocument, firstMatchHtml, largestTextBlockHtml, sleep } from "./dom";

const SOURCE = "apec";
const SEARCH_URL = "https://www.apec.fr/cms/webservices/rechercheOffre";

const API_HEADERS = {
  "user-agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36",
  accept: "application/json, text/plain, */*",
  "accept-language": "fr-FR,fr;q=0.9",
  "content-type": "application/json",
  referer: "https://www.apec.fr/candidat/recherche-emploi.html/emploi",
  origin: "https://www.apec.fr",
};

// Les pages offre APEC sont une SPA Angular (shell vide en GET normal), mais
// APEC sert une version SEO server-rendered aux crawlers de réseaux sociaux :
// on la récupère avec un User-Agent de bot pour obtenir le texte complet.
const DETAIL_HEADERS = {
  "user-agent": "facebookexternalhit/1.1",
  accept: "text/html,application/xhtml+xml",
  "accept-language": "fr-FR,fr;q=0.9",
};
const DETAIL_SELECTORS = ["body p", "main", "article", "body"];

const CONTRACT_MAP: Record<string, string> = {
  "101888": "CDI",
  "101887": "CDD",
  "101889": "Intérim",
  "597137": "Alternance",
  "597138": "Stage",
  "597139": "Freelance",
  "143684": "Stage",
  "143685": "Alternance",
};

type ApecJob = {
  id?: number | string;
  numeroOffre?: string;
  intitule?: string;
  lieuTexte?: string;
  salaireTexte?: string;
  texteOffre?: string;
  datePublication?: string;
  typeContrat?: string | number;
  clientReel?: unknown;
  contractDuration?: number;
};

function escapeHtml(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function textToHtml(s: string): string {
  return s
    .split(/\n\n+/)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

async function searchPage(keywords: string, start: number, size: number): Promise<{ jobs: ApecJob[]; total: number }> {
  const body = {
    motsCles: keywords,
    lieux: [],
    fonctions: [],
    secteursActivite: [],
    typesContrat: [],
    typesConvention: ["143684", "143685", "143686", "143687", "143706"],
    niveauxExperience: [],
    sorts: [{ type: "DATE", direction: "DESCENDING" }],
    pagination: { startIndex: start, range: size },
    activeFiltre: true,
    typeClient: "CADRE",
  };
  const res = await fetch(SEARCH_URL, {
    method: "POST",
    headers: API_HEADERS,
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`APEC HTTP ${res.status}`);
  const data = await res.json();
  return { jobs: (data.resultats ?? []) as ApecJob[], total: data.totalCount ?? 0 };
}

async function fetchDetailHtml(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { headers: DETAIL_HEADERS });
    if (!res.ok) return null;
    const doc = parseDocument(await res.text());
    return firstMatchHtml(doc, DETAIL_SELECTORS, 300) ?? largestTextBlockHtml(doc, 300);
  } catch {
    return null;
  }
}

function toScraped(job: ApecJob, detailHtml: string | null): ScrapedOffre | null {
  const extId = String(job.numeroOffre ?? job.id ?? "");
  const title = (job.intitule ?? "").trim();
  if (!extId || !title) return null;

  let company = "";
  if (typeof job.clientReel === "string" && !["True", "False", "None"].includes(job.clientReel)) {
    company = job.clientReel;
  } else if (job.clientReel && typeof job.clientReel === "object") {
    company = String((job.clientReel as any).nom ?? "");
  }

  const lieu = job.lieuTexte ?? "";
  const city = lieu.split(" - ")[0]?.trim() || null;

  const rawContract = String(job.typeContrat ?? "CDI");
  let contract = CONTRACT_MAP[rawContract] ?? rawContract;
  if (/^\d+$/.test(contract)) contract = "CDI";

  const url = `https://www.apec.fr/candidat/recherche-emploi.html/emploi/detail-offre/${extId}`;
  const snippetText = (job.texteOffre ?? "").trim();
  const description_html = detailHtml ?? textToHtml(snippetText);
  const description_text = detailHtml
    ? parseDocument(`<div>${detailHtml}</div>`).body.textContent?.trim() ?? snippetText
    : snippetText;

  if (!description_text) return null;

  return {
    source_id: extId,
    url,
    title,
    company,
    country: "France",
    location: city,
    contract_type: contract,
    salary: job.salaireTexte?.trim() || null,
    description_html,
    description_text,
    description_status: "ok",
    posted_at: job.datePublication ? String(job.datePublication).slice(0, 10) : null,
    is_vie: detectVie({ source: SOURCE, title, description: description_text, url }),
    raw_payload: { numeroOffre: extId, lieuTexte: lieu, typeContrat: rawContract },
  };
}

export const apecScraper: Scraper = {
  name: SOURCE,
  async *scrape(criteria: ScrapeCriteria, onEvent: (e: ProgressEvent) => void) {
    onEvent({ kind: "start", source: SOURCE });

    // APEC = France uniquement. Si l'utilisateur cible d'autres pays sans la France, on passe.
    const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
    const wantsFrance =
      !criteria.countries.length || criteria.countries.some((c) => norm(c) === "france");
    if (!wantsFrance) {
      onEvent({ kind: "list", source: SOURCE, total: 0 });
      onEvent({ kind: "done", source: SOURCE, seen: 0, ok: 0, failed: 0 });
      return;
    }

    const max = criteria.maxOffres ?? 60;
    const queries = criteria.sectors.length ? criteria.sectors : [""];
    const seen = new Map<string, ApecJob>();

    for (const q of queries) {
      let start = 0;
      const size = 20;
      while (seen.size < max && start < 100) {
        try {
          const { jobs } = await searchPage(q, start, size);
          if (!jobs.length) break;
          for (const j of jobs) {
            const id = String(j.numeroOffre ?? j.id ?? "");
            if (id && !seen.has(id)) seen.set(id, j);
          }
          if (jobs.length < size) break;
          start += size;
          await sleep(800);
        } catch {
          break;
        }
      }
      if (seen.size >= max) break;
    }

    const jobs = Array.from(seen.values()).slice(0, max);
    onEvent({ kind: "list", source: SOURCE, total: jobs.length });

    let ok = 0;
    let failed = 0;
    for (let i = 0; i < jobs.length; i++) {
      const job = jobs[i];
      try {
        const extId = String(job.numeroOffre ?? job.id ?? "");
        const url = `https://www.apec.fr/candidat/recherche-emploi.html/emploi/detail-offre/${extId}`;
        const detailHtml = await fetchDetailHtml(url);
        const offre = toScraped(job, detailHtml);
        if (offre) {
          yield offre;
          ok++;
          onEvent({ kind: "offre", source: SOURCE, index: i + 1, total: jobs.length, status: "ok" });
        } else {
          failed++;
          onEvent({ kind: "offre", source: SOURCE, index: i + 1, total: jobs.length, status: "failed" });
        }
        await sleep(600 + Math.random() * 500);
      } catch {
        failed++;
        onEvent({ kind: "offre", source: SOURCE, index: i + 1, total: jobs.length, status: "failed" });
      }
    }
    onEvent({ kind: "done", source: SOURCE, seen: jobs.length, ok, failed });
  },
};
