import "server-only";
import { JSDOM } from "jsdom";

// Parse un document HTML côté serveur. jsdom est déjà présent (dépendance
// d'isomorphic-dompurify) — bien plus rapide qu'un aller-retour Playwright
// pour les pages server-rendered.
export function parseDocument(html: string): Document {
  const dom = new JSDOM(html, { contentType: "text/html" });
  return dom.window.document;
}

// Extrait le HTML interne du premier sélecteur qui matche avec suffisamment de texte.
export function firstMatchHtml(
  doc: Document,
  selectors: string[],
  minTextLength = 150
): string | null {
  for (const sel of selectors) {
    let els: Element[];
    try {
      els = Array.from(doc.querySelectorAll(sel));
    } catch {
      continue;
    }
    for (const el of els) {
      const text = el.textContent?.trim() ?? "";
      if (text.length >= minTextLength) return el.innerHTML;
    }
  }
  return null;
}

const NOISE_MARKERS = [
  "quick apply",
  "voir plus",
  "postuler",
  "cookies",
  "connexion",
  "inscription",
  "menu",
  "newsletter",
];

// Fallback : bloc de texte le plus pertinent quand les sélecteurs échouent.
// On maximise la DENSITÉ de texte (longueur / nb de descendants) plutôt que la
// longueur brute, pour éviter d'attraper le conteneur global (header + nav + tout).
export function largestTextBlockHtml(doc: Document, minLength = 200): string | null {
  let best: Element | null = null;
  let bestScore = 0;
  for (const el of Array.from(doc.querySelectorAll("article, section, div, p"))) {
    const tag = el.closest("nav, header, footer, aside");
    if (tag) continue;
    const text = el.textContent?.trim() ?? "";
    const len = text.length;
    if (len < minLength || len > 20000) continue;
    const noiseHits = NOISE_MARKERS.filter((m) => text.toLowerCase().includes(m)).length;
    const descendants = el.getElementsByTagName("*").length + 1;
    // Densité pondérée : favorise le texte long peu fragmenté et sans bruit
    const density = (len / descendants) * (1 - Math.min(0.6, noiseHits * 0.15));
    if (density > bestScore) {
      bestScore = density;
      best = el;
    }
  }
  return best ? best.innerHTML : null;
}

export type JobPostingLd = {
  title: string | null;
  company: string | null;
  locality: string | null;
  country: string | null;
  description_html: string | null;
  contract_type: string | null;
  salary: string | null;
  posted_at: string | null;
};

// Extrait un JobPosting schema.org depuis les balises <script type="application/ld+json">.
// Nettement plus robuste que les sélecteurs CSS (insensible aux changements d'UI).
export function extractJobPostingLd(doc: Document): JobPostingLd | null {
  const scripts = Array.from(doc.querySelectorAll('script[type="application/ld+json"]'));
  for (const s of scripts) {
    const raw = s.textContent?.trim();
    if (!raw) continue;
    let parsed: any;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue;
    }
    const candidates = Array.isArray(parsed) ? parsed : [parsed, ...(parsed["@graph"] ?? [])];
    for (const j of candidates) {
      if (!j || typeof j !== "object") continue;
      const type = j["@type"];
      const isJob = type === "JobPosting" || (Array.isArray(type) && type.includes("JobPosting"));
      if (!isJob) continue;

      const addr =
        j.jobLocation?.address ?? (Array.isArray(j.jobLocation) ? j.jobLocation[0]?.address : null) ?? {};
      const rawCountry = addr?.addressCountry?.name ?? addr?.addressCountry ?? null;
      const salary =
        j.baseSalary?.value?.value != null
          ? `${j.baseSalary.value.value} ${j.baseSalary.currency ?? ""}`.trim()
          : j.baseSalary?.value?.minValue != null
          ? `${j.baseSalary.value.minValue}-${j.baseSalary.value.maxValue ?? ""} ${j.baseSalary.currency ?? ""}`.trim()
          : null;

      return {
        title: j.title ?? null,
        company: j.hiringOrganization?.name ?? null,
        locality: addr?.addressLocality ?? null,
        country: typeof rawCountry === "string" ? rawCountry : null,
        description_html: typeof j.description === "string" ? j.description : null,
        contract_type: Array.isArray(j.employmentType)
          ? j.employmentType.join(", ")
          : j.employmentType ?? null,
        salary,
        posted_at: j.datePosted ?? null,
      };
    }
  }
  return null;
}

export const BROWSER_HEADERS = {
  "user-agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36",
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "accept-language": "fr-FR,fr;q=0.9,en;q=0.8",
};

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
