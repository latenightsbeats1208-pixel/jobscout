/**
 * Typographie (française ou anglaise) et nettoyages de rendu, partagés par les
 * templates PDF (react-pdf) et DOCX. Aucune dépendance serveur : importable partout.
 */
import { LABELS, type DocLang } from "./lang";

export const NBSP = "\u00a0";

/** Espaces insécables avant : ; ! ? et à l'intérieur des guillemets « », espaces multiples, espaces avant virgule. */
export function frenchTypography(input: string | null | undefined): string {
  if (!input) return "";
  let t = String(input).replace(/\r/g, "").replace(/[ \t ]+/g, " ").trim();
  // Deux-points suivi d'un espace ou en fin de chaîne (épargne les URL « https:// » et les heures « 18:30 »)
  t = t.replace(/\s*:(?=\s|$)/g, `${NBSP}:`);
  t = t.replace(/\s*([;!?])(?=\s|$|[»)"'])/g, `${NBSP}$1`);
  t = t.replace(/«\s*/g, `«${NBSP}`).replace(/\s*»/g, `${NBSP}»`);
  t = t.replace(/\s+,/g, ",").replace(/\s+\.(?!\.)/g, ".");
  t = t.replace(/\(\s+/g, "(").replace(/\s+\)/g, ")");
  t = t.replace(/ {2,}/g, " ");
  return t;
}

/**
 * Typographie anglaise : aucun espace avant la ponctuation haute (« Trilingual :
 * French » est une faute en anglais), guillemets droits doubles à la place des
 * chevrons, espaces multiples réduits.
 */
export function englishTypography(input: string | null | undefined): string {
  if (!input) return "";
  let t = String(input).replace(/\r/g, "").replace(/[ \t ]+/g, " ").trim();
  t = t.replace(/\s+([:;!?,])/g, "$1");
  t = t.replace(/\s+\.(?!\.)/g, ".");
  t = t.replace(/«\s*/g, "“").replace(/\s*»/g, "”");
  t = t.replace(/\(\s+/g, "(").replace(/\s+\)/g, ")");
  t = t.replace(/ {2,}/g, " ");
  return t;
}

/** Fonction de typographie à appliquer selon la langue du document. */
export function typographyFor(lang: DocLang): (input: string | null | undefined) => string {
  return lang === "en" ? englishTypography : frenchTypography;
}

/** Retire les marques de genre des intitulés d'offre : « F/H », « (H/F) », « H/F/X », « - F/H », « (m/f/d) », « M/F », « m/w/d »… */
export function cleanJobTitle(title: string | null | undefined): string {
  if (!title) return "";
  let t = String(title);
  t = t.replace(/\s*[\-–—|:]?\s*\(?\s*\b[HFMW]\s*\/\s*[HFMW](?:\s*\/\s*[XDI])?\b\s*\)?/gi, " ");
  t = t.replace(/\s{2,}/g, " ").replace(/[\s\-–—|,:]+$/g, "").trim();
  return t;
}

/**
 * « Anglais (C2) », « Anglais (C2, TOEIC 925) » — jamais de parenthèses imbriquées.
 * Un niveau « C2 (TOEIC 925) » devient « (C2, TOEIC 925) » : une seule paire de
 * parenthèses, même forme pour toutes les langues.
 */
export function formatLanguage(name: string, level: string | null | undefined): string {
  const lvl = (level ?? "").trim();
  if (!lvl) return name;
  const flat = lvl
    .replace(/\s*\(([^)]*)\)/g, ", $1")
    .replace(/\s{2,}/g, " ")
    .replace(/^,\s*/, "")
    .trim();
  return `${name} (${flat})`;
}

/** URL lisible sur un CV : sans protocole ni « www. », sans « / » final. */
export function displayUrl(url: string | null | undefined): string {
  if (!url) return "";
  return String(url).trim().replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/+$/, "");
}

/** Première lettre en capitale (sans toucher au reste : « Premiere Pro », « SQL »). */
export function capitalizeFirst(s: string): string {
  const t = s.trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : t;
}

/** Marqueurs « poste en cours », apostrophe droite ou typographique (’ ‘ ʼ). Partagé avec le tri (cv-shape). */
export const ONGOING_RE = /^(present|présent|aujourd['’‘ʼ]?hui|actuel(le)?|en cours|current|now|ongoing)$/i;

/** Dates de formation : l'année seule (« 2024 - 2025 ») — le mois n'apporte rien et est souvent inventé. */
export function eduYear(d: string | null | undefined, lang: DocLang = "fr"): string {
  if (!d) return "";
  const v = d.trim();
  if (ONGOING_RE.test(v)) return LABELS[lang].ongoing;
  const m = v.match(/(\d{4})/);
  return m ? m[1] : v;
}

export function eduYearRange(start?: string | null, end?: string | null, lang: DocLang = "fr"): string {
  const s = eduYear(start, lang);
  const e = eduYear(end, lang);
  if (s && e) return s === e ? s : `${s} - ${e}`;
  return s || e || "";
}

/** Date d'expérience : « 2024-03 » → « 03/2024 » ; poste en cours → « Aujourd'hui » / « Present ». */
export function expDate(d: string | null | undefined, lang: DocLang = "fr"): string {
  if (!d) return "";
  const v = d.trim();
  if (ONGOING_RE.test(v)) return LABELS[lang].ongoing;
  const m = v.match(/^(\d{4})-(\d{2})$/);
  if (m) return `${m[2]}/${m[1]}`;
  return v;
}

export function expDateRange(start?: string | null, end?: string | null, lang: DocLang = "fr"): string {
  const s = expDate(start, lang);
  const e = expDate(end, lang);
  if (s && e) return `${s} - ${e}`;
  return s || e || "";
}
