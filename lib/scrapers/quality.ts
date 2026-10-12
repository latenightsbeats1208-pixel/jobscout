import { PHRASE_TOKENS, TITLE_NOISE, normalize, tokenize } from "@/lib/scoring/text";

/**
 * Contrôle de qualité de chaque offre collectée, quelle que soit la source.
 *
 * Né d'une mesure : 36 % des descriptions France Travail étaient celles d'un
 * autre poste, ou le texte d'une page de résultats, sans que rien ne le
 * signale. Une offre douteuse est désormais marquée — « partial » ou
 * « failed » — et le journal du scan le dit, source par source.
 *
 * Un contrôle ne supprime jamais une offre : il qualifie sa description.
 * Une description « failed » n'est ni montrée comme telle, ni notée sur son
 * contenu, ni envoyée à la relecture par l'IA.
 */

export type QualityIssue =
  | "description_sans_rapport"
  | "page_de_resultats"
  | "extrait_court"
  | "texte_parasite"
  | "sans_date"
  | "sans_lieu"
  | "sans_entreprise";

export const QUALITY_LABELS: Record<QualityIssue, string> = {
  description_sans_rapport: "description qui ne parle pas du poste du titre",
  page_de_resultats: "texte d'une page de résultats au lieu de l'annonce",
  extrait_court: "extrait court au lieu de l'annonce complète",
  texte_parasite: "texte de blocage géographique retiré",
  sans_date: "sans date",
  sans_lieu: "sans lieu",
  sans_entreprise: "sans entreprise",
};

/** Problèmes qui rendent la description inutilisable. */
const FAILING: QualityIssue[] = ["description_sans_rapport", "page_de_resultats"];

/** En dessous, c'est un extrait de liste de résultats, pas une annonce. */
export const MIN_DESCRIPTION_CHARS = 400;

/**
 * Phrases ajoutées par le site en tête de l'annonce, quand elle est servie à un
 * visiteur d'un autre pays (Talent.com, dans la langue du domaine).
 */
const PARASITES = [
  /cette offre d['’]emploi n['’]est pas disponible dans votre pays\.?/i,
  /deze vacature is niet beschikbaar in je land\.?/i,
  /diese stelle ist in deinem land nicht verfügbar\.?/i,
  /this job (?:offer |posting )?is not available in your country\.?/i,
];

const RESULTS_PAGE =
  /la liste des offres d['’]emploi est restitu[ée]e par ordre de pertinence|d['’]autres offres peuvent vous int[ée]resser|visualiser les r[ée]sultats de votre recherche/i;

/** Mots de titre trop vagues pour juger qu'une description s'y rapporte. */
const VAGUE = new Set(["tech", "poste", "emploi", "offre", "job", "mission", "service", "startup", "hightech"]);

type Status = "ok" | "partial" | "failed";
const RANK: Record<Status, number> = { ok: 0, partial: 1, failed: 2 };
const worst = (a: Status, b: Status): Status => (RANK[a] >= RANK[b] ? a : b);

export type QualityInput = {
  title: string;
  company: string | null;
  location: string | null;
  posted_at: string | null;
  description_text: string;
  description_html: string;
  description_status: Status;
};

export type QualityResult = {
  status: Status;
  issues: QualityIssue[];
  /** Description débarrassée des textes parasites. */
  description_text: string;
  description_html: string;
};

/**
 * La description parle-t-elle du poste du titre ? Au moins un mot porteur du
 * titre (hors contrat, niveau et lieu) doit s'y retrouver, au radical près.
 * Sans mot porteur dans le titre, on ne conclut rien.
 */
export function describesTitle(title: string, description: string, location: string | null): boolean {
  const place = new Set(tokenize(location ?? ""));
  const titleWords = [...new Set(tokenize(title))].filter(
    (t) => t.length >= 3 && !TITLE_NOISE.has(t) && !VAGUE.has(t) && !place.has(t)
  );
  // Un seul mot court (« agent », « chef ») ou une seule expression (« tech lead »)
  // est une preuve trop mince : « Tech Agent » chez Renault décrit bien un poste
  // de technicien d'atelier, et une annonce de tech lead parle « d'encadrer les
  // équipes techniques » sans jamais écrire « tech lead ».
  if (!titleWords.length) return true;
  if (titleWords.length === 1 && (titleWords[0].length < 7 || PHRASE_TOKENS.has(titleWords[0]))) return true;
  const words = new Set(tokenize(description));
  const stems = new Set([...words].map((w) => w.slice(0, 5)));
  // « tech » d'un titre abrège « technicien » : on l'accepte comme preuve.
  return titleWords.some((t) => words.has(t) || (t.length >= 5 && stems.has(t.slice(0, 5))));
}

export function assessQuality(o: QualityInput): QualityResult {
  const issues: QualityIssue[] = [];
  let text = o.description_text ?? "";
  let html = o.description_html ?? "";

  // 1. Textes parasites : retirés, pas seulement signalés.
  const head = text.slice(0, 300);
  for (const re of PARASITES) {
    if (re.test(head)) {
      text = text.replace(re, "").trim();
      html = html.replace(re, "");
      if (!issues.includes("texte_parasite")) issues.push("texte_parasite");
    }
  }

  // 2. Le texte décrit-il bien cette offre ?
  if (RESULTS_PAGE.test(normalize(text).replace(/’/g, "'")) || RESULTS_PAGE.test(text)) issues.push("page_de_resultats");
  else if (text.length >= 200 && !describesTitle(o.title, text, o.location)) issues.push("description_sans_rapport");
  if (text.length < MIN_DESCRIPTION_CHARS) issues.push("extrait_court");

  // 3. Champs manquants : signalés, sans effet sur le statut.
  if (!o.posted_at) issues.push("sans_date");
  if (!o.location?.trim()) issues.push("sans_lieu");
  if (!o.company?.trim()) issues.push("sans_entreprise");

  let status: Status = o.description_status;
  if (issues.some((i) => FAILING.includes(i))) status = "failed";
  else if (issues.includes("extrait_court")) status = worst(status, "partial");
  return { status, issues, description_text: text, description_html: html };
}

/** Résumé d'un lot pour le journal du scan : « 15 × description qui ne parle pas du poste du titre · 50 × sans date ». */
export function summarizeIssues(counts: Partial<Record<QualityIssue, number>>): string | null {
  const order: QualityIssue[] = ["description_sans_rapport", "page_de_resultats", "extrait_court", "texte_parasite", "sans_date", "sans_lieu", "sans_entreprise"];
  const parts = order
    .filter((k) => (counts[k] ?? 0) > 0)
    .map((k) => `${counts[k]} × ${QUALITY_LABELS[k]}`);
  return parts.length ? parts.join(" · ") : null;
}
