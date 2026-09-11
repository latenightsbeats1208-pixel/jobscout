import "server-only";
import type { Browser, BrowserContext } from "playwright";
import {
  applyBrowsersPath,
  isEngineInstalled,
  ENGINE_MISSING_MESSAGE,
} from "./browser-engine";

export type ScrapedOffre = {
  source_id: string;
  url: string;
  title: string;
  company: string;
  country: string | null;
  location: string | null;
  contract_type: string | null;
  salary: string | null;
  description_html: string;
  description_text: string;
  description_status: "ok" | "failed" | "partial";
  posted_at: string | null;
  is_vie: boolean;
  raw_payload: Record<string, unknown>;
  scrape_errors?: string;
};

export type ScrapeCriteria = {
  sectors: string[];
  countries: string[];
  maxOffres?: number;
};

export type ProgressEvent =
  | { kind: "start"; source: string }
  | { kind: "list"; source: string; total: number }
  | { kind: "offre"; source: string; index: number; total: number; status: "ok" | "failed" }
  | { kind: "done"; source: string; seen: number; ok: number; failed: number };

export interface Scraper {
  name: string;
  scrape(criteria: ScrapeCriteria, onEvent: (e: ProgressEvent) => void): AsyncGenerator<ScrapedOffre>;
}

let _browser: Browser | null = null;

export async function getBrowser(): Promise<Browser> {
  if (_browser && _browser.isConnected()) return _browser;
  // Le moteur est optionnel (téléchargé à la demande) : on pointe le registre
  // Playwright sur les données utilisateur AVANT le premier require, puis on
  // échoue avec un message actionnable s'il n'est pas encore là.
  applyBrowsersPath();
  if (!isEngineInstalled()) throw new Error(ENGINE_MISSING_MESSAGE);
  const { chromium } = await import("playwright");
  _browser = await chromium.launch({ headless: true });
  return _browser;
}

export async function newContext(): Promise<BrowserContext> {
  const browser = await getBrowser();
  return browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36",
    viewport: { width: 1366, height: 900 },
    locale: "fr-FR",
  });
}

export function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
