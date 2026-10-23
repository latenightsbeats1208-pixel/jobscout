// @ts-check
// Normalisation des noms de lieux, partagée par le script de build
// (scripts/build-geo.mjs, qui pré-calcule les clés des fichiers de données)
// et par le moteur (lib/geo/index.ts, qui normalise les requêtes).
// Un seul code pour les deux côtés : toute dérive casserait l'appariement en
// silence. Changer quoi que ce soit ici oblige à incrémenter NORM_VERSION puis
// à relancer `node scripts/build-geo.mjs <sources>` (un test le vérifie).

export const NORM_VERSION = 1;

/** @type {Record<string, string>} */
const LIGATURES = {
  "œ": "oe",
  "æ": "ae",
  "ß": "ss",
  "ø": "o",
  "ł": "l",
  "đ": "d",
  "ð": "d",
  "þ": "th",
  "ı": "i",
  "ħ": "h",
};

/** @type {Record<string, string>} */
const TOKENS = { st: "saint", ste: "sainte", sts: "saints", stes: "saintes" };

/**
 * Minuscules, sans accents ni ligatures, ponctuation (tirets, apostrophes
 * droites ou typographiques, points, barres…) ramenée à des espaces simples,
 * « st »/« ste » développés. Tout caractère hors [a-z0-9] disparaît, y
 * compris les écritures non latines.
 * @param {string} s
 * @returns {string}
 */
export function normalize(s) {
  if (!s) return "";
  let t = s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  t = t.replace(/[œæßøłđðþıħ]/g, (c) => LIGATURES[c] ?? c);
  t = t.replace(/[^a-z0-9]+/g, " ").trim();
  if (!t) return "";
  if (/\bst(e?s?)\b/.test(t)) {
    t = t
      .split(" ")
      .map((w) => TOKENS[w] ?? w)
      .join(" ");
  }
  return t;
}
