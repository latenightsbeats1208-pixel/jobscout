import "server-only";
import type { ProfileFull, Language } from "@/lib/cv/types";
import { classifyContract, type ContractCategory } from "@/lib/contracts";
import {
  ABBREVIATIONS,
  TITLE_NOISE,
  buildCorpus,
  containsPhrase,
  idf,
  informativeness,
  joinTokens,
  normalize,
  phraseIdf,
  titleIdf,
  tokenize,
  type Corpus,
} from "./text";
import { assessSeniority, profileExperienceYears } from "./seniority";
import { assessLanguage, profileLanguages, type Mastery } from "./language";
import { aiExclusion, aiRelevance, isReviewUsable, type AiReview } from "./review";
import { parseSearchArea, type SearchArea } from "@/lib/geo/fr";
import { zoneFit } from "@/lib/geo/locate";
import { decodeHtmlEntities } from "@/lib/text/entities";

export type { Corpus } from "./text";
export { buildCorpus } from "./text";

export type ScoreResult = {
  score: number;
  breakdown: {
    /** Mots-clés de recherche (anciennement « secteur »), pondérés par leur rareté. */
    sector: number;
    skills: number;
    country: number;
    language: number;
    duration: number;
    contract: number;
    /** Proximité entre l'intitulé de l'offre et les postes visés. */
    title: number;
    /** Adéquation entre l'expérience demandée et celle du profil. */
    seniority: number;
    /** Lieu par rapport à la zone de recherche (100 dans, 70 proche, 20 hors) ; absent si inconnu. */
    location?: number;
    /** Motif d'exclusion : l'offre est hors critères, quelle que soit sa note. */
    excluded?: string;
    /** Verdict de la relecture par l'IA, quand elle a remplacé la pertinence locale. */
    ai_verdict?: string;
  };
  reason: string;
};

/**
 * Composition de la note. Les critères éliminatoires (langue, pays, expérience)
 * sont des FILTRES et non des poids : additionnés aux autres, un bon intitulé
 * compensait une langue que la personne ne parle pas.
 *
 * Les compétences ne sont PAS un filtre, bien qu'elles devraient l'être : la
 * note locale ne voit une compétence que si l'annonce la nomme, et beaucoup
 * décrivent le métier en phrases (« pipelines de données », « rédaction des
 * cahiers de test »). Mesuré sur le banc (tests/scoring-eval.test.ts) : en
 * faire un filtre, ou un multiplicateur de l'intitulé, écartait des offres
 * pertinentes — NDCG@20 de 78 % à 71 %. Ce jugement revient à une relecture
 * par l'IA, qui comprend ces phrases.
 *
 * Parmi les offres acceptables : intitulé et compétences portent la note, les
 * mots-clés de recherche pèsent peu (chaque offre trouvée les contient déjà).
 */
const WEIGHTS = { title: 0.48, skills: 0.42, keywords: 0.1 };
/** Note de compétences qui vaut le plein crédit : aucun profil ne couvre 100 % d'une annonce. */
const SKILLS_FULL_CREDIT = 80;

/** Plafond d'une offre hors critères : elle reste visible, en fin de liste. */
const EXCLUDED_CAP = 15;

// ----------------------------------------------------------------------------
// Préparation (une fois par lot)
// ----------------------------------------------------------------------------

type PreparedOffer = {
  titleTokens: string[];
  titleJoined: string;
  bodyTokens: Set<string>;
  bodyJoined: string;
  requirementTokens: string[];
};

const REQUIREMENT_HEADERS = [
  "profil recherche", "votre profil", "le profil", "profil souhaite", "competences requises",
  "competences attendues", "vos competences", "qualifications", "requirements", "what you'll bring",
  "what you will bring", "what we're looking for", "what we are looking for", "you have", "your profile",
  "who you are", "ce que nous recherchons", "vous etes", "vous avez", "experience requise", "must have",
];

/** Bloc « profil recherché » de l'annonce, ou à défaut son début. */
function requirementSection(description: string): string {
  const text = normalize(description);
  let at = -1;
  for (const h of REQUIREMENT_HEADERS) {
    const i = text.indexOf(h);
    if (i >= 0 && (at < 0 || i < at)) at = i;
  }
  return at >= 0 ? text.slice(at, at + 1500) : text.slice(0, 3000);
}

function prepareOffer(o: ScoringInput): PreparedOffer {
  // La ville ou le pays repris dans le titre (« … - Rouen ») ne disent rien du métier.
  const place = new Set(tokenize(`${o.location ?? ""} ${o.country ?? ""}`));
  const titleTokens = tokenize(o.title).filter((t) => !TITLE_NOISE.has(t) && !place.has(t));
  const body = tokenize(`${o.title}\n${o.description_text}`);
  return {
    titleTokens,
    titleJoined: joinTokens(titleTokens),
    bodyTokens: new Set(body),
    bodyJoined: joinTokens(body),
    requirementTokens: [...new Set(tokenize(requirementSection(o.description_text)))],
  };
}

const TRAINEE_TITLE = /\b(stage|stagiaire|intern|internship|alternance|alternant|apprenti|apprentie|apprentice|trainee)/;

type PreparedSkill = { name: string; tokens: string[]; anchored: boolean; info: number };

type PreparedProfile = {
  targets: { label: string; tokens: string[]; weight: number }[];
  skills: PreparedSkill[];
  keywords: { tokens: string[]; info: number }[];
  vocabulary: Set<string>;
  years: number | null;
  languages: Map<string, Mastery> | null;
  area: SearchArea | null;
};

function prepareProfile(profile: ProfileFull, corpus: Corpus): PreparedProfile {
  // Postes visés déclarés, puis les intitulés des expériences (les trois plus
  // récentes), qui comptent moins : on ne cherche pas forcément à refaire son
  // dernier poste. Un stage ou une alternance n'est jamais un poste visé.
  const declared = (profile.target_titles ?? []).filter((t) => t.trim());
  const past = profile.experiences
    .map((e) => e.title)
    .filter((t) => t && !TRAINEE_TITLE.test(normalize(t)))
    .slice(0, 3);
  const targets = [
    ...declared.map((label) => ({ label, weight: 1 })),
    ...past.map((label) => ({ label, weight: declared.length ? 0.6 : 0.9 })),
  ]
    .map((t) => ({ ...t, tokens: [...new Set(tokenize(t.label).filter((x) => !TITLE_NOISE.has(x)))] }))
    .filter((t) => t.tokens.length);

  const skills = profile.skills
    .map((s) => {
      const tokens = tokenize(s.name);
      return {
        name: s.name,
        tokens,
        anchored: s.evidence_experience_ids.length > 0,
        info: Math.max(0.25, informativeness(corpus, phraseIdf(corpus, tokens))),
      };
    })
    .filter((s) => s.tokens.length);

  const keywords = profile.sectors
    .map((k) => tokenize(k))
    .filter((tokens) => tokens.length)
    .map((tokens) => ({ tokens, info: informativeness(corpus, phraseIdf(corpus, tokens)) }));

  const vocabularyText = [
    ...profile.skills.map((s) => s.name),
    ...declared,
    ...profile.experiences.flatMap((e) => [e.title, e.description ?? "", ...e.bullet_points, ...e.skills_used]),
    ...profile.educations.flatMap((e) => [e.degree ?? "", e.field ?? "", e.description ?? ""]),
    profile.summary ?? "",
  ].join("\n");

  return {
    targets,
    skills,
    keywords,
    vocabulary: new Set(tokenize(vocabularyText)),
    years: profileExperienceYears(profile),
    languages: profileLanguages(profile),
    area: parseSearchArea(profile.search_area),
  };
}

// ----------------------------------------------------------------------------
// Intitulé
// ----------------------------------------------------------------------------

/**
 * Proximité de deux intitulés : F2 pondéré par la rareté des mots parmi les
 * titres. Le rappel (les mots du poste visé retrouvés dans le titre de l'offre)
 * compte quatre fois plus que la précision. La précision, elle, se mesure contre
 * TOUT le vocabulaire du profil et non le seul poste visé : « Java » dans le titre
 * pénalise un développeur .NET, « Angular » ne pénalise pas celui qui le pratique.
 */
function titleSimilarity(target: string[], offer: string[], vocabulary: Set<string>, corpus: Corpus): number {
  if (!target.length || !offer.length) return 0;
  const offerSet = new Set(offer);
  const targetSet = new Set(target);
  const credit = (token: string, present: Set<string>): number => {
    if (present.has(token)) return 1;
    const abbr = ABBREVIATIONS[token];
    return abbr && abbr.forms.some((f) => present.has(f)) ? abbr.credit : 0;
  };
  let found = 0;
  let total = 0;
  for (const t of targetSet) {
    const w = titleIdf(corpus, t);
    total += w;
    found += w * credit(t, offerSet);
  }
  const recall = total ? found / total : 0;

  let kept = 0;
  let offered = 0;
  for (const t of offerSet) {
    const w = titleIdf(corpus, t);
    offered += w;
    let c = targetSet.has(t) || vocabulary.has(t) ? 1 : 0;
    for (const [full, abbr] of Object.entries(ABBREVIATIONS)) {
      if (!c && targetSet.has(full) && abbr.forms.includes(t)) c = abbr.credit;
    }
    kept += w * c;
  }
  const precision = offered ? kept / offered : 0;
  if (recall === 0 || precision === 0) return 0;
  return (5 * precision * recall) / (4 * precision + recall);
}

function scoreTitle(p: PreparedProfile, o: PreparedOffer, corpus: Corpus): { score: number; best: string | null } {
  if (!p.targets.length) return { score: 50, best: null };
  let score = 0;
  let best: string | null = null;
  for (const t of p.targets) {
    const s = titleSimilarity(t.tokens, o.titleTokens, p.vocabulary, corpus) * t.weight;
    if (s > score) {
      score = s;
      best = t.label;
    }
  }
  return { score: Math.round(score * 100), best };
}

// ----------------------------------------------------------------------------
// Compétences
// ----------------------------------------------------------------------------

/**
 * Deux mesures complémentaires :
 * - présence : les compétences du profil retrouvées dans l'annonce, mot à mot
 *   et non plus expression exacte, une compétence rare comptant plus qu'une
 *   compétence que toutes les annonces citent ;
 * - couverture : la part des mots rares du bloc « profil recherché » que le
 *   profil couvre — c'est ce que l'offre DEMANDE, et non ce que le profil liste.
 */
function scoreSkills(
  p: PreparedProfile,
  o: PreparedOffer,
  corpus: Corpus
): { score: number; matched: string[]; anchoredMatched: string[] } {
  const matched: string[] = [];
  const anchoredMatched: string[] = [];
  let hit = 0;
  let max = 0;
  let strong = 0;
  for (const s of p.skills) {
    let credit = 0;
    if (containsPhrase(o.bodyJoined, s.tokens)) credit = 1;
    else if (s.tokens.length > 1) {
      let found = 0;
      let total = 0;
      for (const t of s.tokens) {
        const w = idf(corpus, t);
        total += w;
        if (o.bodyTokens.has(t)) found += w;
      }
      const frac = total ? found / total : 0;
      if (frac >= 0.5) credit = 0.6 * frac;
    }
    const w = (s.anchored ? 1.5 : 1) * s.info;
    hit += credit * w;
    max += w;
    if (credit >= 0.5) {
      matched.push(s.name);
      if (s.anchored) anchoredMatched.push(s.name);
      strong += credit * (s.anchored ? 1.5 : 1);
    }
  }
  const presence = max ? 0.5 * (hit / max) + 0.5 * Math.min(1, strong / 3) : 0.3;

  // Couverture des exigences : les 25 mots les plus rares du bloc « profil ».
  const requirements = o.requirementTokens
    .map((t) => ({ t, w: idf(corpus, t) }))
    .filter((x) => informativeness(corpus, x.w) >= 0.5)
    .sort((a, b) => b.w - a.w)
    .slice(0, 25);
  const reqTotal = requirements.reduce((s, x) => s + x.w, 0);
  const reqFound = requirements.reduce((s, x) => s + (p.vocabulary.has(x.t) ? x.w : 0), 0);
  const coverage = reqTotal ? Math.min(1, reqFound / reqTotal / 0.4) : 0;

  return { score: Math.round(100 * (0.65 * presence + 0.35 * coverage)), matched, anchoredMatched };
}

// ----------------------------------------------------------------------------
// Mots-clés de recherche (ex-« secteur »)
// ----------------------------------------------------------------------------

/**
 * Les mots-clés servent de REQUÊTE aux sources : toute offre trouvée les
 * contient déjà. Leur présence ne compte donc qu'à hauteur de leur rareté — un
 * mot-clé présent partout n'apporte presque rien, et il n'y a plus de plancher.
 */
function scoreKeywords(p: PreparedProfile, o: PreparedOffer): { score: number; matched: string[] } {
  if (!p.keywords.length) return { score: 50, matched: [] };
  const values: number[] = [];
  const matched: string[] = [];
  for (const k of p.keywords) {
    const presence = containsPhrase(o.titleJoined, k.tokens) ? 1 : containsPhrase(o.bodyJoined, k.tokens) ? 0.5 : 0;
    values.push(presence * k.info);
    if (presence) matched.push(k.tokens.join(" "));
  }
  const best = Math.max(...values);
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return { score: Math.round(100 * (0.7 * best + 0.3 * mean)), matched };
}

function scoreCountry(targetCountries: string[], offreCountry: string | null): number {
  if (!targetCountries.length) return 50;
  if (!offreCountry) return 50;
  const targetSet = new Set(targetCountries.map(normalize));
  return targetSet.has(normalize(offreCountry)) ? 100 : 0;
}

// ----------------------------------------------------------------------------
// NEW : Duration bonus — V.I.E specific
// ----------------------------------------------------------------------------
//
// V.I.E missions last 6 to 24 months. The "sweet spot" recognized by Business
// France is 12-24 months. Award +5 pts if the offer's stated duration falls
// in that range, +3 pts for 6-11 months, 0 otherwise. Only triggers for V.I.E.

function extractDurationMonths(description: string): number | null {
  const re = /\b(\d{1,2})\s*(?:mois|months?|m[oô]?is)\b/i;
  const m = description.match(re);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  if (Number.isNaN(n) || n < 1 || n > 36) return null;
  return n;
}

function scoreDuration(
  contractCategory: ContractCategory,
  description: string
): { score: number; months: number | null } {
  // Ne s'applique qu'aux V.I.E — on réutilise la classification stricte
  // (detectVie) au lieu d'une regex locale : "\bvie\b" matchait le mot
  // français « vie » dans n'importe quelle description.
  if (contractCategory !== "vie") return { score: 0, months: null };
  const months = extractDurationMonths(description);
  if (months === null) return { score: 30, months: null }; // neutral
  if (months >= 12 && months <= 24) return { score: 100, months };
  if (months >= 6 && months < 12) return { score: 60, months };
  return { score: 20, months };
}

// ----------------------------------------------------------------------------
// Contrat — préférence PAR PROFIL (preferred_contracts)
// ----------------------------------------------------------------------------
//
// Chaque profil déclare les types de contrat recherchés (ex. ["cdi","cdd"] pour
// un diplômé, ["alternance"] pour un étudiant). Barème :
//   catégorie recherchée → 100 (bonus +10)
//   catégorie « autre » / inconnue → 50 (neutre)
//   catégorie identifiée mais non recherchée → 20 (malus −6)

function scoreContract(
  preferred: string[] | undefined,
  offre: ScoringInput
): { score: number; category: ContractCategory; excluded: string | null; freelance: boolean } {
  const category = classifyContract({
    contract_type: offre.contract_type ?? null,
    title: offre.title,
    description_text: offre.description_text,
  });
  const prefs = preferred?.length ? preferred : ["cdi", "cdd"];
  // Le contrat de la source ou le titre disent l'offre ; la description, elle,
  // mentionne aussi « stage » ou « alternance » dans des annonces de CDI.
  const declared = normalize(`${offre.contract_type ?? ""} ${offre.title}`);
  // « Profession libérale - Emploi non salarié », « Franchise - … » : libellés de France Travail.
  const freelance = /\b(freelance|independant|auto entrepreneur|portage salarial|emploi non salarie)\b/.test(declared.replace(/[^a-z]+/g, " "));
  const training =
    (category === "stage" && /\b(stage|stagiaire|internship|intern)\b/.test(declared)) ||
    (category === "alternance" && /\b(alternance|alternant|apprentissage|apprenti|contrat pro)\b/.test(declared));
  const excluded = training && !prefs.includes(category) ? `${category === "stage" ? "stage" : "alternance"}, hors des contrats recherchés` : null;
  if (category === "autre") return { score: 50, category, excluded, freelance };
  if (prefs.includes(category)) return { score: 100, category, excluded, freelance };
  return { score: 20, category, excluded, freelance };
}

// ----------------------------------------------------------------------------
// Note finale
// ----------------------------------------------------------------------------

export type ScoringInput = {
  title: string;
  company: string;
  country: string | null;
  description_text: string;
  contract_type?: string | null;
  /** Ville de l'offre : retirée du titre avant comparaison. */
  location?: string | null;
  /**
   * Texte écarté par le contrôle de qualité (description d'un autre poste) :
   * il ne dit rien du poste, mais sa langue reste celle de l'annonce et de son site.
   */
  language_text?: string | null;
};

function scorePrepared(
  profile: ProfileFull,
  p: PreparedProfile,
  offre: ScoringInput,
  o: PreparedOffer,
  corpus: Corpus,
  rawReview?: AiReview | null
): ScoreResult {
  // Une relecture sans aucune exigence écrite dans l'annonce n'a fait que deviner :
  // elle ne remplace pas la note locale, et la raison le dit.
  const shortAd = !!rawReview && !isReviewUsable(rawReview);
  const review = shortAd ? null : rawReview;
  const title = scoreTitle(p, o, corpus);
  const skills = scoreSkills(p, o, corpus);
  const keywords = scoreKeywords(p, o);
  const country = scoreCountry(profile.target_countries, offre.country);
  const seniority = assessSeniority(p.years, offre.title, offre.description_text);
  const language = assessLanguage(p.languages, offre.title, offre.description_text || offre.language_text || "");
  const contract = scoreContract(profile.preferred_contracts, offre);
  const duration = scoreDuration(contract.category, offre.description_text);
  const zone = zoneFit(p.area, offre);

  // 1. Filtres. Une offre qui en échoue un est « hors critères » : visible en
  //    fin de liste, note plafonnée.
  const exclusions: string[] = [];
  // Les compétences d'abord, quand l'IA a pu les juger (voir lib/scoring/review.ts) :
  // la note locale ne sait pas les juger assez sûrement pour écarter une offre.
  const aiExcluded = review ? aiExclusion(review) : null;
  if (aiExcluded) exclusions.push(aiExcluded);
  if (language.excluded) exclusions.push(language.excluded);
  if (country === 0) exclusions.push(`hors des pays cibles (${offre.country})`);
  if (seniority.excluded) exclusions.push(seniority.excluded);
  if (contract.excluded) exclusions.push(contract.excluded);

  // 2. Pertinence, parmi les offres acceptables. Relue par l'IA, c'est son
  //    jugement (exigences couvertes, métier) qui fait foi.
  const relevance = review
    ? aiRelevance(review)
    : WEIGHTS.title * title.score +
      WEIGHTS.skills * 100 * Math.min(1, skills.score / SKILLS_FULL_CREDIT) +
      WEIGHTS.keywords * keywords.score;

  // 3. Ajustements : niveaux partiels (expérience, langue), puis préférences.
  const durationBonus = (duration.score / 100) * 5; // jusqu'à +5, V.I.E seulement
  // Contrat : centré sur 50 → contrat recherché +10, inconnu 0, identifié mais non recherché −6
  const contractDelta = ((contract.score - 50) / 50) * 10;
  // Lieu : la zone choisie par la personne. Hors zone, l'offre reste visible mais
  // passe après les offres de sa zone ; une région voisine coûte peu.
  const zoneFactor = zone.fit === "hors" ? 0.55 : zone.fit === "proche" ? 0.85 : 1;
  // Freelance pour qui cherche un salariat : visible, mais en retrait.
  const freelanceFactor = contract.freelance ? 0.75 : 1;
  let finalScore = Math.round(
    Math.max(
      0,
      Math.min(100, relevance * seniority.factor * language.factor * zoneFactor * freelanceFactor + durationBonus + contractDelta)
    )
  );
  if (exclusions.length) finalScore = Math.min(finalScore, EXCLUDED_CAP);

  const parts: string[] = [];
  if (exclusions.length) parts.push(`Hors critères : ${exclusions[0]}`);
  if (review?.reason) parts.push(`IA : ${review.reason}`);
  if (shortAd) parts.push("relecture IA : annonce trop courte pour juger les exigences");
  // Sans relecture, le détail local ; avec, il n'ajouterait rien à celle-ci.
  if (!review) {
    if (title.best && title.score >= 50) parts.push(`intitulé proche de « ${title.best} »`);
    if (skills.anchoredMatched.length) {
      parts.push(`compétences ancrées : ${skills.anchoredMatched.slice(0, 3).join(", ")}`);
    } else if (skills.matched.length) {
      parts.push(`compétences : ${skills.matched.slice(0, 3).join(", ")}`);
    } else if (!offre.description_text.trim()) {
      // Description écartée par le contrôle de qualité, ou introuvable.
      parts.push("description indisponible : note fondée sur le seul titre");
    } else if (p.skills.length) {
      parts.push("aucune compétence du profil reconnue dans l'annonce");
    }
  }
  if (zone.fit === "hors") parts.push(`hors de votre zone (${zone.place})`);
  else if (zone.fit === "proche") parts.push(`près de votre zone (${zone.place})`);
  if (contract.freelance) parts.push("freelance");
  if (!seniority.excluded && seniority.note) parts.push(seniority.note);
  if (!language.excluded && language.note) parts.push(language.note);
  if (duration.months && duration.score >= 60) parts.push(`durée ${duration.months} mois`);
  if (contract.score === 100) parts.push(`${contract.category.toUpperCase()} recherché`);
  else if (contract.score === 20) parts.push(`${contract.category} (non ciblé)`);
  const reason = parts.length ? parts.join(" · ") : "Faible recouvrement avec votre profil";

  return {
    score: finalScore,
    breakdown: {
      sector: keywords.score,
      skills: skills.score,
      country,
      language: language.score,
      duration: duration.score,
      contract: contract.score,
      title: title.score,
      seniority: seniority.score,
      ...(zone.fit ? { location: zone.fit === "dans" ? 100 : zone.fit === "proche" ? 70 : 20 } : {}),
      ...(exclusions.length ? { excluded: exclusions.join(" ; ") } : {}),
      ...(review ? { ai_verdict: review.verdict } : {}),
    },
    reason,
  };
}

/**
 * Note d'une seule offre. Sans `corpus`, la rareté des mots ne peut pas être
 * mesurée et tous les mots pèsent pareil : préférer `scoreOffresLocal`, ou
 * passer le corpus de toutes les offres de la base.
 */
/** Texte d'annonce sans entités HTML (« 6&#xa0;ans ») : les offres déjà en base en gardent. */
function cleanInput(o: ScoringInput): ScoringInput {
  return { ...o, title: decodeHtmlEntities(o.title), description_text: decodeHtmlEntities(o.description_text) };
}

export function scoreOffreLocal(profile: ProfileFull, rawOffre: ScoringInput, corpus?: Corpus): ScoreResult {
  const offre = cleanInput(rawOffre);
  const c = corpus ?? buildCorpus([offre]);
  return scorePrepared(profile, prepareProfile(profile, c), offre, prepareOffer(offre), c);
}

/**
 * Note d'un lot d'offres. La rareté des mots se mesure sur `corpus` quand il
 * est fourni (toutes les offres de la base), sinon sur le lot lui-même.
 */
export function scoreOffresLocal(
  profile: ProfileFull,
  offres: ScoringInput[],
  corpus?: Corpus,
  /** Relectures par l'IA alignées sur `offres` ; l'appelant n'y met que celles encore valables. */
  reviews?: (AiReview | null | undefined)[]
): ScoreResult[] {
  offres = offres.map(cleanInput);
  const c = corpus ?? buildCorpus(offres);
  const p = prepareProfile(profile, c);
  return offres.map((o, i) => scorePrepared(profile, p, o, prepareOffer(o), c, reviews?.[i]));
}
