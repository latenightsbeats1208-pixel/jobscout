import "server-only";
import type { Scraper } from "./base";
import { wttjScraper } from "./wttj";
import { linkedinScraper } from "./linkedin";
import { civiwebScraper } from "./civiweb";
import { apecScraper } from "./apec";
import { helloworkScraper } from "./hellowork";
import { francetravailScraper } from "./francetravail";
import { talentScraper } from "./talent";

export const scrapers: Record<string, Scraper> = {
  wttj: wttjScraper,
  linkedin: linkedinScraper,
  civiweb: civiwebScraper,
  apec: apecScraper,
  hellowork: helloworkScraper,
  francetravail: francetravailScraper,
  talent: talentScraper,
};

export const VALID_SOURCES = Object.keys(scrapers);

export function getEnabledScrapers(enabled: string[]): Scraper[] {
  return enabled.map((id) => scrapers[id]).filter(Boolean);
}
