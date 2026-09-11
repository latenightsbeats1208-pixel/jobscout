import "server-only";
import type { Scraper, ScrapedOffre, ScrapeCriteria, ProgressEvent } from "./base";
import { htmlToText, newContext } from "./base";
import { detectVie } from "@/lib/vie";
import { normalizeCountryName, strictCountryName } from "@/lib/countries";

const SOURCE = "linkedin";

type ListingCard = {
  jobId: string;
  url: string;
  title: string;
  company: string;
  location: string | null;
  posted_at: string | null;
};

export const linkedinScraper: Scraper = {
  name: SOURCE,
  async *scrape(criteria: ScrapeCriteria, onEvent: (e: ProgressEvent) => void) {
    onEvent({ kind: "start", source: SOURCE });
    const ctx = await newContext();
    const page = await ctx.newPage();
    const max = criteria.maxOffres ?? 300;

    try {
      const seen = new Set<string>();
      const cards: ListingCard[] = [];

      const countries = criteria.countries.length ? criteria.countries : [""];
      // 2 pages max par combinaison secteur×pays : avec une liste de pays large
      // (ex. francophonie), on couvre chaque pays au lieu d'épuiser le budget
      // sur la première combinaison.
      for (const sector of criteria.sectors.length ? criteria.sectors : [""]) {
        for (const country of countries) {
          if (cards.length >= max) break;
          let start = 0;
          for (let p = 0; p < 2 && cards.length < max; p++) {
            const url = `https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?keywords=${encodeURIComponent(
              sector
            )}&location=${encodeURIComponent(country)}&start=${start}`;
            let pageCards: ListingCard[] = [];
            try {
              await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
              await page.waitForTimeout(400);
              pageCards = await extractListingCards(page);
            } catch {
              break;
            }
            if (!pageCards.length) break;
            let added = 0;
            for (const c of pageCards) {
              if (seen.has(c.jobId)) continue;
              seen.add(c.jobId);
              cards.push(c);
              added++;
              if (cards.length >= max) break;
            }
            if (added === 0) break;
            start += 25;
          }
        }
      }

      onEvent({ kind: "list", source: SOURCE, total: cards.length });

      let ok = 0;
      let failed = 0;
      let consecutiveFails = 0;
      const MAX_CONSECUTIVE_FAILS = 15;
      let aborted = false;
      const PER_FETCH_TIMEOUT_MS = 45000; // hard cap per offer to prevent the scraper from hanging

      for (let i = 0; i < cards.length && !aborted; i++) {
        const c = cards[i];
        try {
          // Race the fetch against a hard timeout so a hung Playwright eval can't freeze the scan
          const offre = await Promise.race<ScrapedOffre>([
            fetchDetail(page, c),
            new Promise<ScrapedOffre>((_, rej) =>
              setTimeout(() => rej(new Error("LinkedIn fetch timeout (45s)")), PER_FETCH_TIMEOUT_MS)
            ),
          ]);
          yield offre;
          if (offre.description_status === "ok") {
            ok++;
            consecutiveFails = 0;
            onEvent({
              kind: "offre",
              source: SOURCE,
              index: i + 1,
              total: cards.length,
              status: "ok",
            });
          } else {
            failed++;
            consecutiveFails++;
            onEvent({
              kind: "offre",
              source: SOURCE,
              index: i + 1,
              total: cards.length,
              status: "failed",
            });
            if (consecutiveFails >= MAX_CONSECUTIVE_FAILS) aborted = true;
          }
        } catch {
          failed++;
          consecutiveFails++;
          onEvent({
            kind: "offre",
            source: SOURCE,
            index: i + 1,
            total: cards.length,
            status: "failed",
          });
          if (consecutiveFails >= MAX_CONSECUTIVE_FAILS) aborted = true;
        }
      }
      onEvent({ kind: "done", source: SOURCE, seen: ok + failed, ok, failed });
    } finally {
      await ctx.close();
    }
  },
};

async function extractListingCards(page: any): Promise<ListingCard[]> {
  return await page.evaluate(() => {
    const cards: any[] = [];
    // Each result is a <li> wrapping a card. Selectors may vary, so we look for any anchor pointing to /jobs/view/
    const anchors = Array.from(
      document.querySelectorAll(
        "a[href*='/jobs/view/'], a[data-tracking-control-name*='job']"
      )
    ) as HTMLAnchorElement[];

    const seen = new Set<string>();
    for (const a of anchors) {
      const href = a.href || "";
      const m = href.match(/\/jobs\/view\/(?:[^/?#]+-)?(\d+)/);
      if (!m) continue;
      const jobId = m[1];
      if (seen.has(jobId)) continue;
      seen.add(jobId);

      // Climb up to the surrounding card
      let card: HTMLElement | null = a;
      for (let i = 0; i < 6 && card; i++) {
        if (card.matches("li, div.base-card, div.base-search-card, .job-search-card")) break;
        card = card.parentElement;
      }
      const root = (card ?? a) as HTMLElement;

      const text = (sel: string) =>
        (root.querySelector(sel) as HTMLElement | null)?.textContent?.trim() || "";

      const title =
        text(".base-search-card__title") ||
        text("h3") ||
        a.querySelector(".sr-only")?.textContent?.trim() ||
        a.textContent?.trim() ||
        "";

      const company =
        text(".base-search-card__subtitle a") ||
        text(".base-search-card__subtitle") ||
        text("h4 a") ||
        text("h4") ||
        "";

      const location =
        text(".job-search-card__location") || text(".job-result-card__location") || null;

      const time = root.querySelector("time");
      const posted_at = time?.getAttribute("datetime") || null;

      const cleanUrl = `https://www.linkedin.com/jobs/view/${jobId}`;
      cards.push({
        jobId,
        url: cleanUrl,
        title,
        company,
        location,
        posted_at,
      });
    }
    return cards;
  });
}

async function fetchDetail(page: any, card: ListingCard): Promise<ScrapedOffre> {
  const guestUrl = `https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/${card.jobId}`;
  let attempt = 0;
  let lastErr: string | undefined;
  while (attempt < 3) {
    try {
      await page.goto(guestUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.waitForTimeout(400);

      const data = await page.evaluate(() => {
        const text = (sel: string) =>
          (document.querySelector(sel) as HTMLElement | null)?.textContent?.trim() || "";
        const html = (sel: string) =>
          (document.querySelector(sel) as HTMLElement | null)?.innerHTML || "";

        const title =
          text(".top-card-layout__title") ||
          text(".topcard__title") ||
          text("h1, h2") ||
          "";

        const company =
          text(".topcard__org-name-link") ||
          text(".topcard__flavor--black-link") ||
          text("a[data-tracking-control-name='public_jobs_topcard-org-name']") ||
          text(".topcard__flavor:first-child") ||
          "";

        const location =
          text(".topcard__flavor--bullet") ||
          text(".topcard__flavor.topcard__flavor--bullet") ||
          text(".job-details-jobs-unified-top-card__primary-description") ||
          "";

        const desc =
          html(".show-more-less-html__markup") ||
          html(".description__text") ||
          html("section.description") ||
          html("article") ||
          "";

        const time = document.querySelector("time");
        const datePosted = time?.getAttribute("datetime") || null;

        // JSON-LD fallback (LinkedIn embeds JobPosting schema)
        let ld: any = null;
        try {
          const scripts = Array.from(
            document.querySelectorAll('script[type="application/ld+json"]')
          ) as HTMLScriptElement[];
          for (const s of scripts) {
            const j = JSON.parse(s.textContent || "");
            if (j["@type"] === "JobPosting" || (Array.isArray(j) && j.find((x: any) => x["@type"] === "JobPosting"))) {
              ld = Array.isArray(j) ? j.find((x: any) => x["@type"] === "JobPosting") : j;
              break;
            }
          }
        } catch {}

        // Criteria list (employment type, seniority, etc.)
        const criteria: Record<string, string> = {};
        document.querySelectorAll(".description__job-criteria-item").forEach((el) => {
          const k = el.querySelector("h3")?.textContent?.trim();
          const v = el.querySelector("span")?.textContent?.trim();
          if (k && v) criteria[k] = v;
        });

        return { title, company, location, desc, datePosted, ld, criteria };
      });

      const desc = data.desc || data.ld?.description || "";
      if (!desc || desc.length < 80) {
        lastErr = `description trop courte (${desc.length} chars) — page bloquée ou sans contenu`;
        attempt++;
        // Backoff: wait a bit longer between retries to dodge rate-limit
        await page.waitForTimeout(1500 + attempt * 1500);
        continue;
      }

      const text = htmlToText(desc);
      const title = data.title || data.ld?.title || card.title || "Offre LinkedIn";
      const company =
        data.company || data.ld?.hiringOrganization?.name || card.company || "";
      const location =
        data.location ||
        data.ld?.jobLocation?.address?.addressLocality ||
        card.location ||
        null;
      // Pays : JSON-LD quand il existe, sinon déduit du libellé de lieu
      // (« Paris, Île-de-France, France » → « France »). Sans cela, 100 % des
      // offres LinkedIn restaient sans pays et perdaient 10 points de score.
      const country =
        normalizeCountryName(data.ld?.jobLocation?.address?.addressCountry || null) ??
        inferCountryFromLocation(location);
      const contract_type =
        data.criteria["Type d'emploi"] ||
        data.criteria["Employment type"] ||
        data.ld?.employmentType ||
        null;

      return {
        source_id: card.jobId,
        url: card.url,
        title,
        company,
        country,
        location,
        contract_type,
        salary: null,
        description_html: desc,
        description_text: text,
        description_status: "ok",
        posted_at: data.datePosted || data.ld?.datePosted || card.posted_at || null,
        is_vie: detectVie({
          source: "linkedin",
          title,
          description: text,
          url: card.url,
        }),
        raw_payload: { jobId: card.jobId, criteria: data.criteria },
      };
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
      attempt++;
    }
  }
  return {
    source_id: card.jobId,
    url: card.url,
    title: card.title || "Description non récupérée",
    company: card.company || "",
    country: inferCountryFromLocation(card.location),
    location: card.location,
    contract_type: null,
    salary: null,
    description_html: "",
    description_text: "",
    description_status: "failed",
    posted_at: card.posted_at,
    is_vie: false,
    raw_payload: { jobId: card.jobId },
    scrape_errors: lastErr,
  };
}

/** « Paris, Île-de-France, France » → « France » ; « Montréal, QC, Canada » → « Canada ». */
function inferCountryFromLocation(location: string | null | undefined): string | null {
  if (!location) return null;
  const parts = location.split(",").map((x) => x.trim()).filter(Boolean);
  // Strict : « Annecy » ou « Genève et périphérie » ne doivent jamais devenir un pays.
  for (let i = parts.length - 1; i >= 0; i--) {
    const c = strictCountryName(parts[i]);
    if (c) return c;
  }
  return null;
}
