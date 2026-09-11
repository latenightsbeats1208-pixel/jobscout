import "server-only";
import type { Scraper, ScrapedOffre, ScrapeCriteria, ProgressEvent } from "./base";
import { detectVie } from "@/lib/vie";
import { normalizeCountryName } from "@/lib/countries";

const SOURCE = "civiweb";
const API_BASE = "https://civiweb-api-prd.azurewebsites.net";
const SITE_BASE = "https://mon-vie-via.businessfrance.fr";

const HEADERS = {
  "content-type": "application/json",
  origin: SITE_BASE,
  referer: `${SITE_BASE}/offres`,
  "user-agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0",
  accept: "application/json",
};

const PAGE_SIZE = 50;

type CiviwebOffer = {
  id: number;
  missionTitle: string;
  organizationName: string;
  organizationPresentation?: string;
  countryName: string | null;
  cityName: string | null;
  missionDescription: string;
  missionDuration?: string;
  missionType?: string;
  missionStartDate?: string;
  missionEndDate?: string;
  startBroadcastDate?: string;
  endBroadcastDate?: string;
  creationDate?: string;
  reference?: string;
  indemnite?: number;
  specialization?: string[];
};

function toDescriptionHtml(o: CiviwebOffer): string {
  const parts: string[] = [];
  if (o.missionDescription) {
    parts.push(`<h2>Mission</h2>${escapeAndParagraph(String(o.missionDescription))}`);
  }
  if (o.organizationPresentation) {
    parts.push(`<h2>Entreprise</h2>${escapeAndParagraph(String(o.organizationPresentation))}`);
  }
  const meta: string[] = [];
  if (o.missionDuration != null && o.missionDuration !== "")
    meta.push(`<li><strong>Durée :</strong> ${escapeHtml(String(o.missionDuration))} mois</li>`);
  if (o.missionStartDate)
    meta.push(`<li><strong>Démarrage :</strong> ${escapeHtml(String(o.missionStartDate).slice(0, 10))}</li>`);
  if (o.indemnite) meta.push(`<li><strong>Indemnité mensuelle :</strong> ${o.indemnite} €</li>`);
  if (o.endBroadcastDate)
    meta.push(
      `<li><strong>Date limite candidature :</strong> ${escapeHtml(String(o.endBroadcastDate).slice(0, 10))}</li>`
    );
  if (o.reference) meta.push(`<li><strong>Référence :</strong> ${escapeHtml(String(o.reference))}</li>`);
  if (meta.length) parts.push(`<h2>Informations clés</h2><ul>${meta.join("")}</ul>`);
  return parts.join("\n");
}

function toDescriptionText(o: CiviwebOffer): string {
  const lines: string[] = [];
  if (o.missionDescription) lines.push(o.missionDescription.trim());
  if (o.organizationPresentation) {
    lines.push("");
    lines.push("À propos de l'entreprise :");
    lines.push(o.organizationPresentation.trim());
  }
  if (o.missionDuration) lines.push(`Durée : ${o.missionDuration}`);
  if (o.missionStartDate) lines.push(`Démarrage : ${o.missionStartDate.slice(0, 10)}`);
  if (o.indemnite) lines.push(`Indemnité : ${o.indemnite} € / mois`);
  if (o.endBroadcastDate) lines.push(`Date limite : ${o.endBroadcastDate.slice(0, 10)}`);
  if (o.reference) lines.push(`Référence : ${o.reference}`);
  return lines.join("\n");
}

function escapeHtml(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Civiweb returns countries in CAPS without accents and sometimes with slash-separated aliases.
// e.g. "ETATS-UNIS", "TCHEQUIE / REPUBLIQUE TCHEQUE", "ROYAUME-UNI"
const CIVIWEB_COUNTRY_FIXES: Record<string, string> = {
  "etats-unis": "États-Unis",
  "etats unis": "États-Unis",
  usa: "États-Unis",
  "royaume-uni": "Royaume-Uni",
  "royaume uni": "Royaume-Uni",
  tchequie: "Tchéquie",
  "republique tcheque": "Tchéquie",
  bresil: "Brésil",
  perou: "Pérou",
  "coree du sud": "Corée du Sud",
  japon: "Japon",
  "emirats arabes unis": "Émirats arabes unis",
  egypte: "Égypte",
  "nouvelle-zelande": "Nouvelle-Zélande",
  norvege: "Norvège",
  hongrie: "Hongrie",
  irlande: "Irlande",
  algerie: "Algérie",
  senegal: "Sénégal",
  grece: "Grèce",
  suede: "Suède",
  "ile maurice": "Île Maurice",
  equateur: "Équateur",
  "republique dominicaine": "République Dominicaine",
};

function fixCiviwebCountry(raw: string | null | undefined): string | null {
  if (!raw) return null;
  // Try each part separated by /
  const candidates = String(raw).split(/[\/]/).map((p) => p.trim());
  for (const c of candidates) {
    const norm = c.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
    if (CIVIWEB_COUNTRY_FIXES[norm]) return CIVIWEB_COUNTRY_FIXES[norm];
    // Try via the central library
    const fromLib = normalizeCountryName(c);
    if (fromLib && fromLib !== c) return fromLib;
  }
  // No mapping found — title-case the first candidate
  const first = candidates[0] || raw;
  return first
    .toLowerCase()
    .replace(/(^|[\s\-])([a-zà-ÿ])/g, (_, sep, ch) => sep + ch.toUpperCase());
}

function escapeAndParagraph(s: string): string {
  return s
    .split(/\n\n+/)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

function pickPostedDate(o: CiviwebOffer): string | null {
  // Most reliable signal of "when this offer became visible"
  return o.startBroadcastDate || o.creationDate || null;
}

function offerToScraped(o: CiviwebOffer): ScrapedOffre {
  const url = `${SITE_BASE}/offres/${o.id}`;
  const description_html = toDescriptionHtml(o);
  const description_text = toDescriptionText(o);
  const country = fixCiviwebCountry(o.countryName);
  const title = o.missionTitle?.trim() || "Offre V.I.E";

  return {
    source_id: String(o.id),
    url,
    title,
    company: o.organizationName?.trim() || "",
    country,
    location: o.cityName?.trim() || null,
    contract_type: o.missionType || "V.I.E",
    salary: o.indemnite ? `${o.indemnite} € / mois` : null,
    description_html,
    description_text,
    description_status: "ok",
    posted_at: pickPostedDate(o),
    is_vie: detectVie({ source: SOURCE, title, description: description_text, url }),
    raw_payload: {
      id: o.id,
      reference: o.reference,
      durationMonths: o.missionDuration,
      startDate: o.missionStartDate,
      endApplyDate: o.endBroadcastDate,
    },
  };
}

async function fetchPage(skip: number, limit: number): Promise<CiviwebOffer[]> {
  const res = await fetch(`${API_BASE}/api/Offers/search`, {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify({ skip, limit }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json()) as { result: CiviwebOffer[]; count: number };
  return data.result ?? [];
}

export const civiwebScraper: Scraper = {
  name: SOURCE,
  async *scrape(criteria: ScrapeCriteria, onEvent: (e: ProgressEvent) => void) {
    onEvent({ kind: "start", source: SOURCE });

    const max = criteria.maxOffres ?? 600;
    const targetCountries = (criteria.countries ?? []).map((c) =>
      c.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    );
    const sectors = (criteria.sectors ?? []).map((s) => s.toLowerCase());

    // 1. Fetch all pages until we hit max or no more results
    const allOffers: CiviwebOffer[] = [];
    let skip = 0;
    let consecutiveEmpty = 0;
    while (allOffers.length < max && consecutiveEmpty < 2) {
      try {
        const batch = await fetchPage(skip, PAGE_SIZE);
        if (batch.length === 0) {
          consecutiveEmpty++;
          break;
        }
        consecutiveEmpty = 0;
        allOffers.push(...batch);
        if (batch.length < PAGE_SIZE) break; // last page
        skip += PAGE_SIZE;
      } catch {
        consecutiveEmpty++;
      }
    }

    // 2. Filter by user country (if specified) and sectors (if specified)
    // V.I.E specificity: missions are by definition abroad. If the user only has
    // "France" in their target countries, we WIDEN the filter (otherwise no V.I.E
    // would ever pass — Civiweb has near-zero French missions).
    const foreignTargets = targetCountries.filter((c) => c !== "france");
    const applyCountryFilter = foreignTargets.length > 0;

    const filtered = allOffers.filter((o) => {
      if (applyCountryFilter) {
        const c = (o.countryName ?? "")
          .toLowerCase()
          .normalize("NFD")
          .replace(/[̀-ͯ]/g, "");
        // Be permissive: token contained in either direction (e.g. "etats-unis" ⊃ "etats unis")
        const matchCountry = foreignTargets.some((tc) => {
          if (!c || !tc) return false;
          const tcTokens = tc.split(/[\s\-\/]+/).filter((t) => t.length >= 3);
          return tcTokens.some((t) => c.includes(t)) || c.split(/[\s\-\/]+/).some((t) => t.length >= 3 && tc.includes(t));
        });
        if (!matchCountry) return false;
      }
      if (sectors.length > 0) {
        const haystack = `${o.missionTitle ?? ""} ${o.missionDescription ?? ""}`.toLowerCase();
        const matchSector = sectors.some((s) =>
          s
            .split(/[\s/-]+/)
            .filter((t) => t.length >= 3)
            .some((t) => haystack.includes(t))
        );
        if (!matchSector) return false;
      }
      return true;
    });

    // Sort by broadcast date desc (most recent first)
    filtered.sort((a, b) => {
      const da = a.startBroadcastDate || a.creationDate || "";
      const db = b.startBroadcastDate || b.creationDate || "";
      return db.localeCompare(da);
    });

    onEvent({ kind: "list", source: SOURCE, total: filtered.length });

    // 3. Yield each offer as a ScrapedOffre
    let ok = 0;
    let failed = 0;
    for (let i = 0; i < filtered.length; i++) {
      const raw = filtered[i];
      try {
        const offre = offerToScraped(raw);
        yield offre;
        ok++;
        onEvent({
          kind: "offre",
          source: SOURCE,
          index: i + 1,
          total: filtered.length,
          status: "ok",
        });
      } catch {
        failed++;
        onEvent({
          kind: "offre",
          source: SOURCE,
          index: i + 1,
          total: filtered.length,
          status: "failed",
        });
      }
    }
    onEvent({ kind: "done", source: SOURCE, seen: filtered.length, ok, failed });
  },
};
