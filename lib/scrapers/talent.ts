import type { SearchArea } from "@/lib/geo/fr";
import { quotaPerQuery } from "@/lib/scan/search-plan";
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

// Talent.com a un sous-domaine par pays, avec le même markup SSR. Tous vérifiés
// (cartes et adresses présentes) en octobre 2026 ; ie.talent.com répond sans
// aucune carte et n'y est pas. Seuls 9 pays y figuraient jusque-là : un profil
// qui visait les Pays-Bas ne recevait qu'une offre néerlandaise (banc marché).
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
  { host: "de.talent.com", country: "Allemagne", codes: ["DE"] },
  { host: "nl.talent.com", country: "Pays-Bas", codes: ["NL"] },
  { host: "uk.talent.com", country: "Royaume-Uni", codes: ["GB"] },
  { host: "es.talent.com", country: "Espagne", codes: ["ES"] },
  { host: "pt.talent.com", country: "Portugal", codes: ["PT"] },
  { host: "it.talent.com", country: "Italie", codes: ["IT"] },
  { host: "at.talent.com", country: "Autriche", codes: ["AT"] },
  { host: "se.talent.com", country: "Suède", codes: ["SE"] },
  { host: "no.talent.com", country: "Norvège", codes: ["NO"] },
  { host: "dk.talent.com", country: "Danemark", codes: ["DK"] },
  { host: "fi.talent.com", country: "Finlande", codes: ["FI"] },
  { host: "pl.talent.com", country: "Pologne", codes: ["PL"] },
  { host: "cz.talent.com", country: "Tchéquie", codes: ["CZ"] },
  { host: "hu.talent.com", country: "Hongrie", codes: ["HU"] },
  { host: "ro.talent.com", country: "Roumanie", codes: ["RO"] },
  { host: "ua.talent.com", country: "Ukraine", codes: ["UA"] },
  { host: "gr.talent.com", country: "Grèce", codes: ["GR"] },
  { host: "tr.talent.com", country: "Turquie", codes: ["TR"] },
  { host: "mx.talent.com", country: "Mexique", codes: ["MX"] },
  { host: "br.talent.com", country: "Brésil", codes: ["BR"] },
  { host: "ar.talent.com", country: "Argentine", codes: ["AR"] },
  { host: "cl.talent.com", country: "Chili", codes: ["CL"] },
  { host: "co.talent.com", country: "Colombie", codes: ["CO"] },
  { host: "pe.talent.com", country: "Pérou", codes: ["PE"] },
  { host: "uy.talent.com", country: "Uruguay", codes: ["UY"] },
  { host: "cr.talent.com", country: "Costa Rica", codes: ["CR"] },
  { host: "pa.talent.com", country: "Panama", codes: ["PA"] },
  { host: "ec.talent.com", country: "Équateur", codes: ["EC"] },
  { host: "cn.talent.com", country: "Chine", codes: ["CN"] },
  { host: "hk.talent.com", country: "Hong Kong", codes: ["HK"] },
  { host: "sg.talent.com", country: "Singapour", codes: ["SG"] },
  { host: "jp.talent.com", country: "Japon", codes: ["JP"] },
  { host: "kr.talent.com", country: "Corée du Sud", codes: ["KR"] },
  { host: "tw.talent.com", country: "Taïwan", codes: ["TW"] },
  { host: "in.talent.com", country: "Inde", codes: ["IN"] },
  { host: "vn.talent.com", country: "Vietnam", codes: ["VN"] },
  { host: "th.talent.com", country: "Thaïlande", codes: ["TH"] },
  { host: "id.talent.com", country: "Indonésie", codes: ["ID"] },
  { host: "my.talent.com", country: "Malaisie", codes: ["MY"] },
  { host: "ph.talent.com", country: "Philippines", codes: ["PH"] },
  { host: "ae.talent.com", country: "Émirats arabes unis", codes: ["AE"] },
  { host: "qa.talent.com", country: "Qatar", codes: ["QA"] },
  { host: "sa.talent.com", country: "Arabie saoudite", codes: ["SA"] },
  { host: "bh.talent.com", country: "Bahreïn", codes: ["BH"] },
  { host: "kw.talent.com", country: "Koweït", codes: ["KW"] },
  { host: "om.talent.com", country: "Oman", codes: ["OM"] },
  { host: "il.talent.com", country: "Israël", codes: ["IL"] },
  { host: "lb.talent.com", country: "Liban", codes: ["LB"] },
  { host: "eg.talent.com", country: "Égypte", codes: ["EG"] },
  { host: "za.talent.com", country: "Afrique du Sud", codes: ["ZA"] },
  { host: "ng.talent.com", country: "Nigéria", codes: ["NG"] },
  { host: "ke.talent.com", country: "Kenya", codes: ["KE"] },
  { host: "gh.talent.com", country: "Ghana", codes: ["GH"] },
  { host: "au.talent.com", country: "Australie", codes: ["AU"] },
  { host: "nz.talent.com", country: "Nouvelle-Zélande", codes: ["NZ"] },
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
  salary: string | null;
  posted_at: string | null;
  snippet: string;
};

/** Pictogrammes de carte qui ne sont pas un type de contrat. */
const NOT_CONTRACT = /quick apply|easy apply|candidature (?:simplifi|rapide)|sponsoris/i;

/**
 * Carte de résultat (structure relevée sur fr.talent.com en octobre 2026) :
 *   <h2>Titre</h2>
 *   <address><span>Entreprise</span><span>•</span><span>Ville, Région, Pays</span></address>
 *   <div><svg title="CDI"/><span>CDI</span></div>        ← contrat (pictogramme titré)
 *   <p>Extrait… <a href="/view?id=…">Voir plus</a></p>
 *   <footer><time dateTime="2026-10-06T17:10:50Z">…</time></footer>
 * L'ancienne lecture cherchait entreprise et lieu dans des <p> d'en-tête : les
 * 225 offres de la base n'avaient aucun lieu, et le premier <span> venu — le nom
 * de l'entreprise — était pris pour le contrat.
 */
function parseSearchPage(html: string, domain: Domain): Card[] {
  const doc = parseDocument(html);
  const out: Card[] = [];
  for (const container of Array.from(doc.querySelectorAll('[data-testid^="jobcard-container-"]'))) {
    // L'identifiant historique reste la clé de l'offre en base : en changer dédoublerait chaque offre déjà collectée.
    const id = container.getAttribute("data-job-id") ?? "";
    if (!id) continue;
    const card =
      container.querySelector('[data-testid="job-card-server"]') ||
      container.querySelector('[data-testid="job-card-unified"]') ||
      container.querySelector("article") ||
      container;

    const title = card.querySelector("h2")?.textContent?.trim() ?? "";
    if (!title) continue;

    let company = "";
    let location = "";
    const addressParts = Array.from(card.querySelectorAll("address span"))
      .map((el) => el.textContent?.trim() ?? "")
      .filter((t) => t && t !== "•");
    if (addressParts.length) {
      company = addressParts[0];
      location = addressParts.length > 1 ? addressParts[addressParts.length - 1] : "";
    } else {
      // Mise en page antérieure : entreprise et lieu dans les <p> courts de l'en-tête.
      const header = card.querySelector("header") ?? card;
      const shortPs = Array.from(header.querySelectorAll("p"))
        .map((el) => el.textContent?.trim() ?? "")
        .filter((t) => t.length > 0 && t.length < 80 && !/voir plus|quick apply/i.test(t));
      company = shortPs[0] ?? "";
      location = shortPs[1] ?? "";
      if (!location && company.includes("•")) {
        const parts = company.split("•").map((x) => x.trim());
        company = parts[0] ?? "";
        location = parts[1] ?? "";
      }
    }

    let contract: string | null = null;
    let salary: string | null = null;
    for (const icon of Array.from(card.querySelectorAll("svg[title]"))) {
      if (icon.closest("header")) continue;
      const label = icon.getAttribute("title")?.trim() ?? "";
      if (!label || NOT_CONTRACT.test(label)) continue;
      // Un montant, quelle que soit la devise (« 45 000 € », « £40,000 », « $60k »).
      if (/[€£$¥₹]|\d/.test(label)) salary ??= label;
      else contract ??= label;
    }

    let snippet = "";
    for (const el of Array.from(card.querySelectorAll("p"))) {
      if (el.closest("header")) continue;
      // Le lien « Voir plus » (« See more », « Meer »… selon le domaine) n'est pas l'annonce.
      const more = el.querySelector("a")?.textContent?.trim() ?? "";
      let t = el.textContent?.trim() ?? "";
      if (more && t.endsWith(more)) t = t.slice(0, -more.length).trim();
      if (t.length > 50) {
        snippet = t.replace(/\.{3}$/, "…");
        break;
      }
    }

    const posted = card.querySelector("time[datetime]")?.getAttribute("datetime") ?? "";
    const href = card.querySelector('a[href*="view?id="]')?.getAttribute("href");
    out.push({
      id,
      url: href ? new URL(href, `https://${domain.host}`).href : `https://${domain.host}/view?id=${id}`,
      title,
      company,
      city: location ? location.split(",")[0].trim() || null : null,
      country: domain.country,
      contract,
      salary,
      posted_at: /^\d{4}-\d{2}-\d{2}/.test(posted) ? posted.slice(0, 10) : null,
      snippet,
    });
  }
  return out;
}

async function fetchSearchPage(domain: Domain, keywords: string, page: number, area?: SearchArea | null): Promise<Card[]> {
  // La zone est française : elle ne s'applique qu'à fr.talent.com (vérifié : « Rhône », octobre 2026).
  const params = new URLSearchParams({ k: keywords, l: area && domain.country === "France" ? area.name : "" });
  if (page > 1) params.set("p", String(page));
  const res = await fetch(`https://${domain.host}/jobs?${params}`, { headers: BROWSER_HEADERS });
  if (!res.ok) throw new Error(`Talent.com ${domain.host} HTTP ${res.status}`);
  return parseSearchPage(await res.text(), domain);
}

async function enrich(card: Card): Promise<ScrapedOffre> {
  let descHtml: string | null = null;
  let ld: ReturnType<typeof extractJobPostingLd> = null;
  try {
    const res = await fetch(card.url, { headers: BROWSER_HEADERS });
    if (res.ok) {
      const doc = parseDocument(await res.text());
      ld = extractJobPostingLd(doc);
      if (ld?.description_html) {
        descHtml = ld.description_html;
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
    // La carte d'abord ; les données structurées de la page de détail complètent.
    company: card.company || ld?.company || "",
    country: card.country,
    location: card.city || ld?.locality || null,
    contract_type: card.contract || ld?.contract_type || null,
    salary: card.salary || ld?.salary || null,
    description_html,
    description_text,
    description_status: okStatus ? "ok" : "failed",
    posted_at: card.posted_at || (ld?.posted_at ? String(ld.posted_at).slice(0, 10) : null),
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
    const queries = criteria.queries.length ? criteria.queries : [""];
    const quota = quotaPerQuery(perDomain, queries.length);
    const seen = new Map<string, Card>();

    for (const domain of activeDomains) {
      for (const q of queries) {
        let taken = 0;
        for (let page = 1; page <= 2 && taken < quota; page++) {
          try {
            const cards = await fetchSearchPage(domain, q, page, criteria.area);
            if (!cards.length) break;
            for (const c of cards) {
              if (!seen.has(c.id) && taken < quota) {
                seen.set(c.id, c);
                taken++;
              }
            }
            if (cards.length < 10) break;
            await sleep(1000);
          } catch {
            break;
          }
        }
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
