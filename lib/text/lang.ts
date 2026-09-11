/**
 * Langue des documents générés (CV, lettre, message V.I.E) — déduite de l'offre.
 * Client-safe : aucune dépendance serveur, importable par les templates PDF/DOCX.
 *
 * Deux langues rendues : « fr » (défaut) et « en ». Une offre rédigée dans une
 * autre langue (espagnol, allemand…) reste servie en français : le marché cible
 * de l'application est la francophonie + Canada / États-Unis.
 *
 * Historique : avant la 3.4.8, la langue n'était jamais déterminée ni transmise.
 * Le prompt disait seulement « anglais si l'offre est principalement en anglais »,
 * le modèle ne traduisait que l'accroche, la relecture (francophone) et les
 * templates (titres de sections, « Aujourd'hui », « Madame, Monsieur », date
 * épistolaire, formule de politesse, espaces insécables) restaient en français.
 */
export type DocLang = "fr" | "en";

const FR_RE =
  /\b(?:le|la|les|et|de|du|des|pour|avec|votre|vous|nous|une|un|au|aux|sur|dans|mission|missions|profil|exp[ée]rience|comp[ée]tences|formation|entreprise|poste)\b/gi;
const EN_RE =
  /\b(?:the|and|of|for|with|your|you|we|our|will|in|at|is|are|experience|skills|team|company|role|responsibilities|requirements|qualifications|candidate)\b/gi;

const count = (s: string, re: RegExp): number => (s.match(re) ?? []).length;

/**
 * « en » seulement si l'anglais domine nettement le texte de l'offre : une
 * offre bilingue ou ambiguë reste en français (marché par défaut).
 *
 * Deux votes doivent concorder : le comptage global de mots-outils ET un vote
 * ligne par ligne. Le comptage global seul basculait en anglais une offre
 * française précédée d'un long « About us » anglais ; le vote par lignes seul
 * basculait en anglais une offre française bilingue dont la traduction anglaise
 * est mise en puces (plus de lignes, moins de mots). Une description sans sauts
 * de ligne retombe sur le comptage global.
 *
 * `hint` : langue déclarée par la source (index Algolia de WTTJ) et `country` :
 * WTTJ traduit en français les missions d'une offre anglophone, ce qui fait
 * pencher le texte vers le français ; mais son champ `language` est parfois
 * faux (offre française taguée « en »). On ne suit donc l'indice « en » que pour
 * un pays anglophone, où l'original est forcément en anglais.
 */
export function detectDocLanguage(
  title: string | null | undefined,
  description: string | null | undefined,
  hint?: string | null,
  country?: string | null
): DocLang {
  if (detectFromText(title, description) === "en") return "en";
  const h = (hint ?? "").trim().toLowerCase().slice(0, 2);
  if (h === "en" && ANGLOPHONE.has((country ?? "").trim().toLowerCase())) return "en";
  return "fr";
}

const ANGLOPHONE = new Set([
  "états-unis", "etats-unis", "royaume-uni", "irlande", "australie", "nouvelle-zélande", "nouvelle-zelande",
]);

function detectFromText(title: string | null | undefined, description: string | null | undefined): DocLang {
  const text = `${title ?? ""}\n${description ?? ""}`;
  const en = count(text, EN_RE);
  if (en < 8) return "fr";
  const fr = count(text, FR_RE);
  if (en <= fr * 1.3) return "fr";
  let frLines = 0;
  let enLines = 0;
  for (const line of text.split(/\n+/)) {
    const f = count(line, FR_RE);
    const e = count(line, EN_RE);
    if (f >= 2 && f > e) frLines++;
    else if (e >= 2 && e > f) enLines++;
  }
  if (enLines + frLines < 3) return "en";
  return enLines >= 3 && enLines > frLines * 1.3 ? "en" : "fr";
}

/**
 * Langue déclarée par la source quand elle existe : champ `language` des hits
 * Algolia de WTTJ (« en », « fr »…). Les autres sources n'en fournissent pas.
 */
export function sourceLanguageHint(source: string | null | undefined, rawPayload: unknown): string | null {
  if (source !== "wttj" || !rawPayload) return null;
  try {
    const payload = typeof rawPayload === "string" ? JSON.parse(rawPayload) : rawPayload;
    const l = (payload as { language?: unknown } | null)?.language;
    return typeof l === "string" && l.trim() ? l : null;
  } catch {
    return null;
  }
}

/** Libellés fixes des templates PDF/DOCX, par langue. */
export const LABELS: Record<
  DocLang,
  {
    profile: string;
    experience: string;
    project: string;
    projects: string;
    education: string;
    skills: string;
    languages: string;
    ongoing: string;
    subject: string;
    salutation: string;
    /** Phrase de politesse finale (français) — null quand la langue n'en utilise pas. */
    closing: string | null;
    /** Ligne de signature (« Sincerely, ») — null en français. */
    signoff: string | null;
  }
> = {
  fr: {
    profile: "Profil",
    experience: "Expérience professionnelle",
    project: "Projet entrepreneurial",
    projects: "Projets entrepreneuriaux",
    education: "Formation",
    skills: "Compétences et langues",
    languages: "Langues",
    ongoing: "Aujourd'hui",
    subject: "Objet",
    salutation: "Madame, Monsieur,",
    closing: "Je vous prie d'agréer, Madame, Monsieur, mes salutations distinguées.",
    signoff: null,
  },
  en: {
    profile: "Profile",
    experience: "Professional Experience",
    project: "Entrepreneurial Project",
    projects: "Entrepreneurial Projects",
    education: "Education",
    skills: "Skills and Languages",
    languages: "Languages",
    ongoing: "Present",
    subject: "Subject",
    salutation: "Dear Hiring Manager,",
    closing: null,
    signoff: "Sincerely,",
  },
};

const FR_MONTHS = [
  "janvier", "février", "mars", "avril", "mai", "juin",
  "juillet", "août", "septembre", "octobre", "novembre", "décembre",
];
const EN_MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/**
 * Ligne de date d'une lettre : « Paris, le 3 septembre 2026 » (« 1er » pour le
 * premier du mois) ou « Paris, September 3, 2026 ».
 */
export function letterDateLine(city: string | null, lang: DocLang, now: Date = new Date()): string {
  const prefix = city ? `${city}, ` : "";
  if (lang === "en") {
    return `${prefix}${EN_MONTHS[now.getMonth()]} ${now.getDate()}, ${now.getFullYear()}`;
  }
  const day = now.getDate() === 1 ? "1er" : String(now.getDate());
  return `${prefix}le ${day} ${FR_MONTHS[now.getMonth()]} ${now.getFullYear()}`;
}

const FR_STOP = new Set([
  "le", "la", "les", "des", "du", "de", "une", "un", "et", "pour", "avec", "dans", "chez", "sur",
  "au", "aux", "est", "sont", "je", "j'ai", "notre", "votre", "nos", "vos", "ainsi", "qui", "que",
  "ne", "pas", "plus", "ce", "cette", "ces", "son", "sa", "ses", "leur", "leurs", "mais", "ou", "où",
  "été", "être", "d'un", "d'une", "par", "à", "auprès", "depuis", "afin", "lors", "selon",
]);
const EN_STOP = new Set([
  "the", "and", "of", "for", "with", "in", "on", "at", "to", "a", "an", "is", "are", "was", "were",
  "by", "from", "as", "that", "this", "our", "your", "we", "you", "i", "its", "their", "led",
  "managed", "built", "created", "developed", "designed", "present", "across", "including",
]);

/**
 * Heuristique « ce texte est (encore) en français » pour un document attendu en
 * anglais : au moins deux mots-outils français et plus de français que
 * d'anglais, ou un mot courant accentué sans aucun mot-outil anglais. Les noms
 * propres capitalisés (« Télécom ») ne déclenchent pas seuls.
 */
export function looksFrench(text: string | null | undefined): boolean {
  if (!text) return false;
  const tokens = text.toLowerCase().split(/[^\p{L}']+/u).filter(Boolean);
  if (tokens.length < 3) return false;
  let fr = 0;
  let en = 0;
  for (const t of tokens) {
    if (FR_STOP.has(t)) fr++;
    else if (EN_STOP.has(t)) en++;
  }
  if (fr >= 2 && fr > en) return true;
  const lowerAccented = /(?:^|[^\p{L}])[a-zà-ÿ]*[éèêàâçùûîôœ][a-zà-ÿ]*/u.test(text);
  return lowerAccented && fr >= 1 && en === 0;
}
