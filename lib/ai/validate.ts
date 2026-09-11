import "server-only";
import type { ProfileFull } from "@/lib/cv/types";
import type { GeneratedCV } from "./generate-cv";

/**
 * Post-LLM anti-hallucination validation — ported from the original Job Scout
 * (`engine/cv_generator_llm.py:_validate_against_profile`).
 *
 * Even with a strict system prompt, Claude can occasionally :
 *   - rename a company ("FORVIA" → "Forvia Faurecia"),
 *   - insert a skill the user never claimed ("PowerBI" when only "Tableau" is in profile),
 *   - keep an experience that was dropped from the profile.
 *
 * We accept reformulations of bullet wording, but we strip any structural
 * entity (company, skill name) that has no anchor in the profile.
 */

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim();
}

/** Tolerant equality — handles small variations like "Société Générale" vs "Societe Generale". */
function looselyEquals(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  return normalize(a) === normalize(b);
}

/** Tolerant inclusion — "Forvia Faurecia" contains "Forvia". */
function looselyContains(haystack: string, needle: string): boolean {
  return normalize(haystack).includes(normalize(needle));
}

export type ValidationReport = {
  warnings: string[];
  stripped: {
    experiences: number;
    skills: number;
  };
};

/**
 * Validates and prunes a generated CV against the user profile.
 * Returns the cleaned CV + a report listing what was dropped (for logging/debug).
 */
export function validateCVAgainstProfile(
  cv: GeneratedCV,
  profile: ProfileFull,
  lang: "fr" | "en" = "fr",
  /** CV en anglais : vocabulaire de compétences du profil traduit (ancrage) ; strict = traduction effective. */
  opts: { extraKnownSkills?: string[]; strict?: boolean } = {}
): { cv: GeneratedCV; report: ValidationReport } {
  const report: ValidationReport = {
    warnings: [],
    stripped: { experiences: 0, skills: 0 },
  };

  // ---- Build the set of "known" entities from the profile -----------------
  const knownCompanies = new Set<string>();
  for (const exp of profile.experiences) {
    if (exp.company) knownCompanies.add(normalize(exp.company));
  }

  const knownSkills = new Set<string>();
  for (const s of profile.skills) {
    if (s.name) knownSkills.add(normalize(s.name));
  }
  for (const exp of profile.experiences) {
    for (const su of exp.skills_used ?? []) {
      if (su) knownSkills.add(normalize(su));
    }
  }
  for (const extra of opts.extraKnownSkills ?? []) {
    if (extra) knownSkills.add(normalize(extra));
  }
  // Education school names also count as legitimate proper nouns to keep
  for (const edu of profile.educations) {
    if (edu.school) knownCompanies.add(normalize(edu.school));
  }

  // ---- 1. Experiences : drop any whose company is not in the profile ------
  const validExperiences = cv.sections.experiences.filter((e) => {
    if (!e.company) {
      // Missing company → keep (could be a freelance mission), but warn
      report.warnings.push(
        `Expérience sans entreprise conservée: ${e.title ?? "(sans titre)"}`
      );
      return true;
    }
    const isKnown =
      knownCompanies.has(normalize(e.company)) ||
      // Tolerate "Company X" included in "Company X SAS"
      [...knownCompanies].some(
        (k) =>
          looselyContains(e.company!, k) || looselyContains(k, e.company!)
      );
    if (!isKnown) {
      report.warnings.push(
        `Expérience ignorée (entreprise inconnue): "${e.title}" chez "${e.company}"`
      );
      report.stripped.experiences++;
      return false;
    }
    return true;
  });

  // Safety floor: keep at least 1 experience even if all flagged, to avoid
  // returning an empty CV in degenerate cases. We re-add the highest-ranked
  // dropped one in that case.
  let finalExperiences = validExperiences;
  if (
    finalExperiences.length === 0 &&
    cv.sections.experiences.length > 0
  ) {
    finalExperiences = [cv.sections.experiences[0]];
    report.warnings.push(
      "Toutes les expériences flagguées : conservation forcée de la première pour ne pas livrer un CV vide."
    );
  }

  // ---- 2. Skills : drop any not anchored in profile.skills or skills_used --
  // Vocabulaire d'UNE compétence connue, mot à mot, pour reconnaître une
  // reformulation dans un autre ordre (« Adobe Suite » vs « Suite Adobe ») —
  // jamais l'union du profil entier, qui laisserait passer « Gestion de
  // données » à partir de « Gestion de projet » + « Analyse de données ».
  const tokensOf = (v: string) => normalize(v).split(/[^a-z0-9+#.]+/).filter((t) => t.length >= 3);
  const knownTokenSets = [...knownSkills].map((k) => new Set(tokensOf(k)));
  // Nom d'outil ou de marque, invariant d'une langue à l'autre : chiffre,
  // capitale interne (« PowerBI », « TikTok », « SEO »), point ou +/# (« Node.js », « C++ »).
  // Un mot seul n'est PAS un signal : « Negotiation », « Accounting » sont génériques.
  const isToolLike = (v: string) =>
    /\d/.test(v) ||
    v.trim().split(/\s+/).some((w) => /^[A-Za-z]+[A-Z]/.test(w) || /\.[a-z]/.test(w) || /[+#]/.test(w));
  // CV en anglais sans vocabulaire traduit (échec silencieux du traducteur) :
  // une compétence générique traduite n'a pas d'ancre littérale française, on
  // la garde avec avertissement ; les noms d'outils restent soumis à l'ancrage.
  const lenient = lang === "en" && !opts.strict;
  const validSkills = cv.sections.skills_flat.filter((s) => {
    const n = normalize(s);
    if (knownSkills.has(n)) return true;
    // Tolerate sub-string match for compound skills ("React Native" vs "React")
    const partial = [...knownSkills].some(
      (k) => k.length >= 3 && (n.includes(k) || k.includes(n))
    );
    if (partial) return true;
    const toks = tokensOf(s);
    if (toks.length && knownTokenSets.some((kt) => toks.every((t) => kt.has(t)))) return true;
    if (lenient && !isToolLike(s)) {
      report.warnings.push('Compétence traduite conservée sans ancre littérale : "' + s + '"');
      return true;
    }
    report.stripped.skills++;
    return false;
  });

  if (report.stripped.skills > 0) {
    report.warnings.push(
      `${report.stripped.skills} compétence(s) non-ancrée(s) supprimée(s) du CV.`
    );
  }

  return {
    cv: {
      ...cv,
      sections: {
        ...cv.sections,
        experiences: finalExperiences,
        skills_flat: validSkills,
      },
    },
    report,
  };
}

/**
 * Light-weight validation for the cover letter — paragraphs are free-form
 * prose, so we cannot strip aggressively without breaking the narrative.
 * We just flag any company mention (capitalized 1-3 word sequence at start
 * of sentence) that isn't a known profile entity, so callers can log it.
 */
export function validateLMAgainstProfile(
  lm: { object: string; body_paragraphs: string[] },
  profile: ProfileFull
): { warnings: string[] } {
  const warnings: string[] = [];
  const knownEntities = new Set<string>();
  for (const exp of profile.experiences) {
    if (exp.company) knownEntities.add(normalize(exp.company));
  }
  for (const edu of profile.educations) {
    if (edu.school) knownEntities.add(normalize(edu.school));
  }

  // Pattern: "chez X" / "Chez X" / "à X" — common LM constructs
  const companyMentionRe =
    /\b(?:chez|à|au sein de|au sein d'|dans)\s+([A-ZÉÈÊÀÂÔÎÛÇ][\wÉÈÊÀÂÔÎÛÇéèêàâôîûç&.'\- ]{2,30}?)(?=[,.!?:;]|$|\s+(?:et|où|qui|que|j'|je))/g;

  for (const para of lm.body_paragraphs) {
    let m: RegExpExecArray | null;
    while ((m = companyMentionRe.exec(para)) !== null) {
      const candidate = normalize(m[1]);
      if (!candidate) continue;
      const known = [...knownEntities].some(
        (k) => candidate.includes(k) || k.includes(candidate)
      );
      if (!known) {
        warnings.push(`LM mentionne "${m[1].trim()}" — non vérifié dans le profil`);
      }
    }
  }
  return { warnings };
}
