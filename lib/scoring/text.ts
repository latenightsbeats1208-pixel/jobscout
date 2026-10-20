/**
 * Texte → jetons comparables, et rareté des jetons sur l'ensemble des offres.
 *
 * Pourquoi la rareté : un mot présent dans presque toutes les offres (« tech »
 * dans un scan lancé sur « tech ») ne distingue rien, un mot rare (« Databricks »,
 * « régulation ») distingue beaucoup. Le poids d'un mot est son IDF au sens de
 * BM25, calculé sur les offres de la base — aucune liste écrite à la main.
 */

export function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

/** Marques de genre et écriture inclusive : « (H/F) », « m/w/d », « développeur(se) », « commercial·e ». */
function stripGenderMarks(s: string): string {
  return s
    .replace(/\(\s*[hfmwdx](?:\s*\/\s*[hfmwdxnb]{1,2})+\s*\)/g, " ")
    .replace(/(^|[^a-z])[hfmw]\s*\/\s*[hfmwd](?:\s*\/\s*[a-z]{1,2})?(?=$|[^a-z])/g, "$1 ")
    .replace(/\((?:e|es|se|euse|rice|trice|ne|fe|le|ere)\)/g, "")
    .replace(/[·•.-](?:e|es|se|euse|rice|trice|ne|fe|ere)(?=$|[^a-z])/g, "");
}

/**
 * Expressions ramenées à un seul jeton AVANT le découpage : sans elles, « Tech
 * Lead Java » partagerait « tech » avec « Tech. de maintenance », et « Business
 * Developer » partagerait « developer » avec « Développeur .NET ».
 */
const PHRASES: [RegExp, string][] = [
  [/\bc\s*#/g, " csharp "],
  [/\basp\s*\.?\s*net(?:\s*core)?\b/g, " aspnet dotnet "],
  [/\.net\b/g, " dotnet "],
  [/\bdot\s*net\b/g, " dotnet "],
  [/\bnode\s*\.?\s*js\b/g, " nodejs "],
  [/\bvue\s*\.?\s*js\b/g, " vuejs "],
  [/\breact\s*\.?\s*js\b/g, " react "],
  [/\bnext\s*\.?\s*js\b/g, " nextjs "],
  [/\btech(?:nical)?[\s-]*lead(?:er)?s?\b/g, " techlead "],
  [/\blead[\s-]+tech\b/g, " techlead "],
  [/\bleaders?\s+techniques?\b/g, " techlead "],
  [/\bhigh[\s-]?tech\b/g, " hightech "],
  [/\bstart[\s-]?ups?\b/g, " startup "],
  [/\bfull[\s-]?stack\b/g, " fullstack "],
  [/\bback[\s-]?end\b/g, " backend "],
  [/\bfront[\s-]?end\b/g, " frontend "],
  [/\bbusiness[\s-]+developers?\b/g, " bizdev "],
  [/\bbiz[\s-]?dev\b/g, " bizdev "],
  [/\bdeveloppeur(?:se)?s?\s+commercia(?:l|le|ux)\b/g, " bizdev "],
  [/\bbusiness\s+analysts?\b/g, " businessanalyst "],
  [/\baccount\s+executives?\b/g, " accountexecutive "],
  [/\baccount\s+managers?\b/g, " accountmanager "],
  [/\bcustomer\s+success\b/g, " customersuccess "],
  [/\bchef(?:fe)?s?\s+de\s+projets?\b/g, " chefprojet "],
  [/\bproject\s+managers?\b/g, " chefprojet "],
  [/\bproduct\s+managers?\b/g, " productmanager "],
  [/\bproduct\s+owners?\b/g, " productowner "],
  [/\bdata\s+engineers?\b/g, " dataengineer "],
  [/\bingenieur(?:e)?s?\s+(?:de\s+)?donnees\b/g, " dataengineer "],
  [/\bdata\s+scientists?\b/g, " datascientist "],
  [/\bdata\s+analysts?\b/g, " dataanalyst "],
  [/\bmachine\s+learning\b/g, " machinelearning "],
  [/\bintelligence\s+artificielle\b/g, " ia "],
  [/\bartificial\s+intelligence\b/g, " ia "],
  [/\bservices?\s+clients?\b/g, " serviceclient "],
  [/\bcustomer\s+(?:service|support|care)\b/g, " serviceclient "],
  [/\bmulti[\s-]*techniques?\b/g, " multitechnique "],
];

/** Jetons nés d'une expression (« techlead », « dataengineer »…) : une annonce les paraphrase souvent. */
export const PHRASE_TOKENS = new Set(PHRASES.flatMap(([, rep]) => rep.trim().split(/\s+/)));

/** Formes équivalentes ramenées à une seule (français ↔ anglais, flexions). */
const CANONICAL: Record<string, string> = {
  developpeur: "developpeur", developpeuse: "developpeur", developer: "developpeur", dev: "developpeur",
  ingenieur: "ingenieur", ingenieure: "ingenieur", engineer: "ingenieur",
  technicien: "technicien", technicienne: "technicien", technician: "technicien",
  analyste: "analyste", analyst: "analyste",
  architecte: "architecte", architect: "architecte",
  consultant: "consultant", consultante: "consultant",
  commercial: "commercial", commerciale: "commercial", commerciaux: "commercial", sale: "commercial",
  vendeur: "vendeur", vendeuse: "vendeur", seller: "vendeur",
  comptable: "comptable", accountant: "comptable",
  comptabilite: "comptabilite", accounting: "comptabilite",
  recruteur: "recrutement", recruteuse: "recrutement", recruiter: "recrutement", recruitment: "recrutement", recrutement: "recrutement", recruiting: "recrutement",
  assistant: "assistant", assistante: "assistant",
  donnee: "data", data: "data",
  ai: "ia", ia: "ia",
  juriste: "juriste", lawyer: "juriste", counsel: "juriste",
  juridique: "juridique", legal: "juridique",
  directeur: "directeur", directrice: "directeur", director: "directeur",
  manager: "manager",
  elect: "electricite", electricite: "electricite", electrique: "electricite", electricien: "electricite", electrical: "electricite", electricity: "electricite",
  industriel: "industriel", industrielle: "industriel", industrial: "industriel",
  itinerant: "itinerant", itinerante: "itinerant", itinerance: "itinerant",
  securite: "securite", security: "securite",
  reseau: "reseau", reseaux: "reseau", network: "reseau",
  logiciel: "logiciel", software: "logiciel",
  assurance: "assurance", insurance: "assurance",
  banque: "banque", bank: "banque", banking: "banque", bancaire: "banque",
  finance: "finance", financier: "finance", financiere: "finance", financial: "finance",
  confirme: "confirme", confirmee: "confirme", experimente: "confirme", experimentee: "confirme", experienced: "confirme",
  senior: "senior", sr: "senior",
  junior: "junior", jr: "junior", debutant: "junior", debutante: "junior",
  stagiaire: "stage", intern: "stage", internship: "stage", stage: "stage",
  alternant: "alternance", alternante: "alternance", alternance: "alternance", apprenti: "alternance", apprentie: "alternance", apprentissage: "alternance", apprentice: "alternance",
};

/**
 * Abréviations qui valent PARTIELLEMENT la forme pleine quand on cherche
 * celle-ci : « Tech. de maintenance » est un technicien, mais « tech » seul est
 * ambigu (« Head of Tech », « HR Tech »), d'où un crédit partiel.
 */
export const ABBREVIATIONS: Record<string, { forms: string[]; credit: number }> = {
  technicien: { forms: ["tech"], credit: 0.7 },
};

const STOPWORDS = new Set([
  "le", "la", "les", "un", "une", "des", "de", "du", "et", "ou", "au", "aux", "en", "dans", "sur", "pour",
  "par", "avec", "sans", "chez", "vers", "ce", "cet", "cette", "ces", "qui", "que", "quoi", "dont", "se",
  "sa", "son", "ses", "il", "elle", "ils", "elles", "on", "est", "sont", "etre", "avoir", "nous", "vous",
  "votre", "vos", "notre", "nos", "leur", "leurs", "plus", "tres", "ne", "pas", "si", "tout", "tous",
  "the", "an", "of", "and", "or", "to", "in", "on", "for", "with", "at", "by", "from", "as", "is", "are",
  "be", "your", "our", "you", "we", "will", "this", "that", "it", "its", "their", "they", "have", "has",
  // Restes de marques de genre ou d'abréviations découpées.
  "hf", "fh", "nb", "fe", "es", "euse", "rice", "trice", "ere", "mwd", "wmd",
]);

/** Bruit propre aux TITRES : contrat et rythme, déjà traités par d'autres critères. */
export const TITLE_NOISE = new Set([
  "cdi", "cdd", "interim", "freelance", "remote", "hybride", "teletravail", "temps", "partiel", "plein",
  "senior", "junior", "confirme", "expert", "stage", "alternance",
]);

function singular(t: string): string {
  if (t.length > 4 && t.endsWith("s") && !/(ss|us|is)$/.test(t)) return t.slice(0, -1);
  return t;
}

export function tokenize(raw: string): string[] {
  let s = stripGenderMarks(normalize(raw));
  for (const [re, rep] of PHRASES) s = s.replace(re, rep);
  const out: string[] = [];
  for (const piece of s.split(/[^a-z0-9+#]+/)) {
    if (piece.length < 2 || /^\d+$/.test(piece)) continue;
    const base = singular(piece);
    const t = CANONICAL[base] ?? CANONICAL[piece] ?? base;
    if (!STOPWORDS.has(t)) out.push(t);
  }
  return out;
}

/** Jetons séparés par des espaces et encadrés : `joined.includes(" a b ")` teste une expression. */
export function joinTokens(tokens: string[]): string {
  return ` ${tokens.join(" ")} `;
}

export function containsPhrase(joined: string, phrase: string[]): boolean {
  return phrase.length > 0 && joined.includes(joinTokens(phrase));
}

// ---------------------------------------------------------------------------
// Rareté sur l'ensemble des offres
// ---------------------------------------------------------------------------

export type Corpus = {
  n: number;
  /** Nombre d'offres dont le titre ou la description contient le mot. */
  df: Map<string, number>;
  /**
   * Même chose sur les seuls TITRES. Un mot banal dans les descriptions peut
   * être rare dans les titres : dans « Tech Lead Data », c'est « Data » qui
   * distingue, alors que les annonces en parlent partout.
   */
  titleDf: Map<string, number>;
  /** Chaque offre, jetons joints : sert au comptage des expressions de plusieurs mots. */
  docs: string[];
  phraseDf: Map<string, number>;
};

export function buildCorpus(offres: { title: string; description_text: string }[]): Corpus {
  const df = new Map<string, number>();
  const titleDf = new Map<string, number>();
  const docs: string[] = [];
  for (const o of offres) {
    const tokens = tokenize(`${o.title}\n${o.description_text}`);
    docs.push(joinTokens(tokens));
    for (const t of new Set(tokens)) df.set(t, (df.get(t) ?? 0) + 1);
    for (const t of new Set(tokenize(o.title))) titleDf.set(t, (titleDf.get(t) ?? 0) + 1);
  }
  return { n: offres.length, df, titleDf, docs, phraseDf: new Map() };
}

/** IDF de BM25 : toujours positif, élevé pour un mot rare, proche de 0 pour un mot omniprésent. */
function idfFromDf(n: number, df: number): number {
  return Math.log(1 + (n - df + 0.5) / (df + 0.5));
}

export function idf(c: Corpus, token: string): number {
  return idfFromDf(c.n, c.df.get(token) ?? 0);
}

/** Rareté d'un mot parmi les titres d'offres. */
export function titleIdf(c: Corpus, token: string): number {
  return idfFromDf(c.n, c.titleDf.get(token) ?? 0);
}

/** IDF d'une expression de plusieurs mots, comptée sur les offres elles-mêmes. */
export function phraseIdf(c: Corpus, phrase: string[]): number {
  if (phrase.length === 0) return 0;
  if (phrase.length === 1) return idf(c, phrase[0]);
  const key = phrase.join(" ");
  let df = c.phraseDf.get(key);
  if (df === undefined) {
    const needle = joinTokens(phrase);
    df = c.docs.reduce((n, d) => (d.includes(needle) ? n + 1 : n), 0);
    c.phraseDf.set(key, df);
  }
  return idfFromDf(c.n, df);
}

/**
 * Part d'information d'un mot, de 0 à 1 : 1 pour un mot présent dans 5 % des
 * offres ou moins, proche de 0 pour un mot présent partout.
 */
export function informativeness(c: Corpus, value: number): number {
  // Trop peu d'offres pour mesurer une rareté : poids neutre plutôt qu'un chiffre au hasard.
  if (c.n < 20) return 0.6;
  const ref = idfFromDf(c.n, c.n * 0.05);
  return Math.max(0, Math.min(1, value / ref));
}
