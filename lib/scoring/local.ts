import "server-only";
import type { ProfileFull, Language } from "@/lib/cv/types";
import { classifyContract, type ContractCategory } from "@/lib/contracts";

export type ScoreResult = {
  score: number;
  breakdown: {
    sector: number;
    skills: number;
    country: number;
    language: number;
    duration: number;
    contract: number;
  };
  reason: string;
};

const STOPWORDS = new Set([
  "le", "la", "les", "un", "une", "des", "de", "du", "et", "ou", "à", "au", "aux", "en",
  "the", "a", "an", "of", "and", "or", "to", "in", "on", "for", "with",
]);

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

function tokenize(s: string): string[] {
  return normalize(s)
    .split(/[^a-z0-9+#.]+/)
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t));
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function containsTerm(text: string, term: string): boolean {
  const t = normalize(term).trim();
  if (t.length < 2) return false;
  const re = new RegExp(`(^|[^a-z0-9+#])${escapeRegex(t)}(?=$|[^a-z0-9+#])`, "g");
  return re.test(text);
}

function scoreSector(
  sectors: string[],
  title: string,
  description: string
): { score: number; matched: string[] } {
  if (!sectors.length) return { score: 50, matched: [] };
  const titleNorm = normalize(title);
  const descNorm = normalize(description);
  const matched: string[] = [];
  let total = 0;

  for (const sector of sectors) {
    const tokens = tokenize(sector);
    if (!tokens.length) continue;
    const inTitle = tokens.some((t) => containsTerm(titleNorm, t));
    const inDesc = tokens.some((t) => containsTerm(descNorm, t));
    if (inTitle) {
      total += 1.0;
      matched.push(sector);
    } else if (inDesc) {
      total += 0.6;
      matched.push(sector);
    }
  }
  const best = sectors.length === 0 ? 0 : (total / sectors.length) * 100;
  const hasTitleMatch = matched.some((s) =>
    tokenize(s).some((t) => containsTerm(titleNorm, t))
  );
  const score = Math.round(Math.min(100, hasTitleMatch ? Math.max(best, 70) : best));
  return { score, matched };
}

function scoreSkills(
  profile: ProfileFull,
  description: string
): { score: number; matched: string[]; anchoredMatched: string[] } {
  if (!profile.skills.length) return { score: 30, matched: [], anchoredMatched: [] };
  const descNorm = normalize(description);

  const anchoredSkills = profile.skills.filter((s) => s.evidence_experience_ids.length > 0);
  const listedSkills = profile.skills.filter((s) => s.evidence_experience_ids.length === 0);

  const matched: string[] = [];
  const anchoredMatched: string[] = [];

  let weightedHits = 0;
  for (const s of anchoredSkills) {
    if (containsTerm(descNorm, s.name)) {
      weightedHits += 2;
      matched.push(s.name);
      anchoredMatched.push(s.name);
    }
  }
  for (const s of listedSkills) {
    if (containsTerm(descNorm, s.name)) {
      weightedHits += 1;
      matched.push(s.name);
    }
  }

  const maxWeight = anchoredSkills.length * 2 + listedSkills.length * 1;
  if (maxWeight === 0) return { score: 30, matched, anchoredMatched };

  const density = weightedHits / maxWeight;
  const absoluteBoost = Math.min(1, matched.length / 6);

  const score = Math.round(Math.min(100, density * 70 + absoluteBoost * 30));
  return { score, matched, anchoredMatched };
}

function scoreCountry(targetCountries: string[], offreCountry: string | null): number {
  if (!targetCountries.length) return 50;
  if (!offreCountry) return 50;
  const targetSet = new Set(targetCountries.map(normalize));
  return targetSet.has(normalize(offreCountry)) ? 100 : 0;
}

// ----------------------------------------------------------------------------
// NEW : Language bonus — ported from the original Job Scout
// ----------------------------------------------------------------------------
//
// Idea : if the offer is mostly written in a language the user masters at a
// usable professional level (B2+), award up to +8 pts. This avoids penalizing
// a French-Spanish profile reading a Spanish-language offer that would
// otherwise score low on keyword density.

const LANG_KEYWORDS: Record<string, RegExp> = {
  fr: /\b(?:le|la|les|et|de|du|des|pour|avec|votre|mission|profil|exp[ée]rience|comp[ée]tences|formation|entreprise)\b/gi,
  en: /\b(?:the|and|of|for|with|your|will|experience|skills|team|company|role|responsibilities)\b/gi,
  es: /\b(?:el|la|los|las|y|de|del|para|con|tu|experiencia|formaci[oó]n|empresa|misi[oó]n|equipo)\b/gi,
  de: /\b(?:der|die|das|und|für|mit|sie|erfahrung|kenntnisse|team|unternehmen|aufgaben)\b/gi,
  it: /\b(?:il|la|gli|le|e|di|del|per|con|tua|esperienza|competenze|azienda|team)\b/gi,
  pt: /\b(?:o|a|os|as|e|de|do|para|com|sua|experi[eê]ncia|empresa|equipe)\b/gi,
};

const LANG_PROFILE_ALIASES: Record<string, string[]> = {
  fr: ["français", "francais", "french"],
  en: ["anglais", "english", "ingles"],
  es: ["espagnol", "spanish", "espanol", "español"],
  de: ["allemand", "german", "deutsch"],
  it: ["italien", "italian", "italiano"],
  pt: ["portugais", "portuguese", "portugues", "português"],
};

const PROFICIENT_LEVELS = /\b(c2|c1|b2|courant|fluent|bilingue|bilingual|natif|native|maternelle|mother)\b/i;

function detectOfferLanguage(title: string, description: string): string {
  const text = `${title}\n${description}`;
  let bestLang = "fr";
  let bestCount = 0;
  for (const [lang, re] of Object.entries(LANG_KEYWORDS)) {
    const m = text.match(re);
    const count = m ? m.length : 0;
    if (count > bestCount) {
      bestCount = count;
      bestLang = lang;
    }
  }
  return bestLang;
}

function userMastersLanguage(profileLanguages: Language[], iso: string): boolean {
  const aliases = LANG_PROFILE_ALIASES[iso] ?? [];
  for (const l of profileLanguages) {
    const name = normalize(l.name ?? "");
    if (!aliases.some((a) => name.includes(normalize(a)))) continue;
    // Default to "the user listed it = they speak it" if no level is given.
    if (!l.level) return true;
    return PROFICIENT_LEVELS.test(l.level);
  }
  return false;
}

function scoreLanguage(
  profileLanguages: Language[],
  title: string,
  description: string
): { score: number; offerLang: string; matched: boolean } {
  const offerLang = detectOfferLanguage(title, description);
  const matched = userMastersLanguage(profileLanguages, offerLang);
  // Full bonus if matched, half if user has English as fallback for non-EN offers
  if (matched) return { score: 100, offerLang, matched: true };
  const hasEnglish = userMastersLanguage(profileLanguages, "en");
  if (hasEnglish && offerLang !== "en")
    return { score: 30, offerLang, matched: false };
  return { score: 0, offerLang, matched: false };
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
): { score: number; category: ContractCategory } {
  const category = classifyContract({
    contract_type: offre.contract_type ?? null,
    title: offre.title,
    description_text: offre.description_text,
  });
  const prefs = preferred?.length ? preferred : ["cdi", "cdd"];
  if (category === "autre") return { score: 50, category };
  if (prefs.includes(category)) return { score: 100, category };
  return { score: 20, category };
}

// ----------------------------------------------------------------------------
// Final scoring : weighted base + language/duration bonuses on top, capped 100
// ----------------------------------------------------------------------------

export type ScoringInput = {
  title: string;
  company: string;
  country: string | null;
  description_text: string;
  contract_type?: string | null;
};

export function scoreOffreLocal(
  profile: ProfileFull,
  offre: ScoringInput
): ScoreResult {
  const sector = scoreSector(profile.sectors, offre.title, offre.description_text);
  const skills = scoreSkills(profile, offre.description_text);
  const country = scoreCountry(profile.target_countries, offre.country);
  const language = scoreLanguage(profile.languages, offre.title, offre.description_text);
  const contract = scoreContract(profile.preferred_contracts, offre);
  const duration = scoreDuration(contract.category, offre.description_text);

  // Weighted base, same balance as before (sector 30 / skills 50 / country 20)
  const base =
    sector.score * 0.3 + skills.score * 0.5 + country * 0.2;

  // Bonuses on top, capped overall at 100. Tuned so a perfect-base offer
  // (100) stays at 100, and a so-so 60-pts offer can climb to ~73 if it
  // matches a 12-24 mois V.I.E in the user's strongest language.
  const languageBonus = (language.score / 100) * 8;   // up to +8
  const durationBonus = (duration.score / 100) * 5;   // up to +5
  // Contrat : centré sur 50 → CDI +10, CDD +7, V.I.E 0, stage/alternance ≈ -8
  const contractDelta = ((contract.score - 50) / 50) * 10;

  const finalScore = Math.round(
    Math.max(0, Math.min(100, base + languageBonus + durationBonus + contractDelta))
  );

  // Build human-readable reason
  const parts: string[] = [];
  if (sector.matched.length) parts.push(`secteur ${sector.matched.slice(0, 2).join("/")}`);
  if (skills.anchoredMatched.length) {
    parts.push(`skills ancrées : ${skills.anchoredMatched.slice(0, 3).join(", ")}`);
  } else if (skills.matched.length) {
    parts.push(`skills : ${skills.matched.slice(0, 3).join(", ")}`);
  }
  if (country === 100) parts.push("pays OK");
  else if (country === 0) parts.push("hors pays cibles");
  if (language.matched) parts.push(`langue ${language.offerLang.toUpperCase()} OK`);
  if (duration.months && duration.score >= 60)
    parts.push(`durée ${duration.months} mois`);
  if (contract.score === 100)
    parts.push(`${contract.category.toUpperCase()} recherché`);
  else if (contract.score === 20)
    parts.push(`${contract.category} (non ciblé)`);
  const reason = parts.length ? parts.join(" · ") : "Faible recouvrement avec votre profil";

  return {
    score: finalScore,
    breakdown: {
      sector: sector.score,
      skills: skills.score,
      country,
      language: language.score,
      duration: duration.score,
      contract: contract.score,
    },
    reason,
  };
}

export function scoreOffresLocal(
  profile: ProfileFull,
  offres: ScoringInput[]
): ScoreResult[] {
  return offres.map((o) => scoreOffreLocal(profile, o));
}
