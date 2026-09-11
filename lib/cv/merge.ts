import "server-only";
import type { ProfileFull, Experience, Education, Skill, Language } from "./types";
import {
  normalizeStr,
  strSim,
  datesOverlap,
  pickLonger,
  pickEarliestDate,
  pickLatestDate,
  mergeStrings,
  mergeBullets,
} from "./similarity";

const LEVEL_ORDER: Record<string, number> = {
  beginner: 1,
  intermediate: 2,
  advanced: 3,
  expert: 4,
};
const CECRL_ORDER = ["", "a1", "a2", "b1", "b2", "c1", "c2", "natif", "native", "courant", "fluent"];

function pickHigherSkillLevel(a: any, b: any): any {
  if (!a) return b;
  if (!b) return a;
  return (LEVEL_ORDER[a] ?? 0) >= (LEVEL_ORDER[b] ?? 0) ? a : b;
}
function pickHigherLangLevel(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  const ai = CECRL_ORDER.indexOf(normalizeStr(a));
  const bi = CECRL_ORDER.indexOf(normalizeStr(b));
  if (ai === -1 && bi === -1) return a;
  return ai >= bi ? a : b;
}

// =============================================================
// Match heuristics
// =============================================================

/**
 * Returns true if both records describe the SAME experience (even if titles differ slightly).
 * Rules:
 *   - Same company (token Jaccard ≥ 0.7) — or both empty
 *   - Title similarity ≥ 0.45
 *   - Date ranges overlap
 */
export function isSameExperience(a: Experience, b: Experience): boolean {
  const companyA = normalizeStr(a.company ?? "");
  const companyB = normalizeStr(b.company ?? "");
  if (companyA && companyB) {
    if (strSim(companyA, companyB) < 0.7) return false;
  }
  // If only one has a company, fall through (could still be same experience)

  const titleSim = strSim(a.title, b.title);
  if (titleSim < 0.45) return false;

  if (!datesOverlap(a, b)) return false;

  return true;
}

/**
 * Same for educations:
 *   - Same school (Jaccard ≥ 0.7)
 *   - Degree OR field similarity ≥ 0.4 (more lax: same school + similar diploma)
 *   - Dates overlap (or one missing dates)
 */
export function isSameEducation(a: Education, b: Education): boolean {
  if (strSim(a.school, b.school) < 0.7) return false;
  const degreeSim = strSim(a.degree ?? "", b.degree ?? "");
  const fieldSim = strSim(a.field ?? "", b.field ?? "");
  // If both degree+field empty on one side, just trust the school match + dates
  if (!a.degree && !a.field) return datesOverlap(a, b);
  if (!b.degree && !b.field) return datesOverlap(a, b);
  if (Math.max(degreeSim, fieldSim) < 0.4) return false;
  return datesOverlap(a, b);
}

// =============================================================
// Merge two records into one (enrichment)
// =============================================================

export function mergeExperience(a: Experience, b: Experience): Experience {
  return {
    ...a,
    title: pickLonger(a.title, b.title) ?? a.title,
    company: pickLonger(a.company ?? "", b.company ?? ""),
    location: pickLonger(a.location ?? "", b.location ?? ""),
    start_date: pickEarliestDate(a.start_date, b.start_date),
    end_date: pickLatestDate(a.end_date, b.end_date),
    description: pickLonger(a.description ?? "", b.description ?? ""),
    bullet_points: mergeBullets(a.bullet_points ?? [], b.bullet_points ?? []),
    skills_used: mergeStrings(a.skills_used ?? [], b.skills_used ?? []),
  };
}

export function mergeEducation(a: Education, b: Education): Education {
  return {
    ...a,
    school: pickLonger(a.school, b.school) ?? a.school,
    degree: pickLonger(a.degree ?? "", b.degree ?? ""),
    field: pickLonger(a.field ?? "", b.field ?? ""),
    location: pickLonger(a.location ?? "", b.location ?? ""),
    start_date: pickEarliestDate(a.start_date, b.start_date),
    end_date: pickLatestDate(a.end_date, b.end_date),
    description: pickLonger(a.description ?? "", b.description ?? ""),
  };
}

// =============================================================
// Merge plan: what's truly new vs what enriches existing
// =============================================================

export type EnrichedExp = {
  index: number;
  before: Experience;
  after: Experience;
  newBullets: string[];
  newSkills: string[];
};
export type EnrichedEdu = {
  index: number;
  before: Education;
  after: Education;
  newBullets: string[];
};

export type MergePlan = {
  newExperiences: Experience[];
  enrichedExperiences: EnrichedExp[];
  newEducations: Education[];
  enrichedEducations: EnrichedEdu[];
  newSkills: Skill[];
  newLanguages: Language[];
  duplicates: {
    skills: number;
    languages: number;
  };
};

const skillKey = (s: Pick<Skill, "name">) => normalizeStr(s.name);
const langKey = (l: Pick<Language, "name">) => normalizeStr(l.name);

export function planMerge(current: ProfileFull, incoming: ProfileFull): MergePlan {
  const plan: MergePlan = {
    newExperiences: [],
    enrichedExperiences: [],
    newEducations: [],
    enrichedEducations: [],
    newSkills: [],
    newLanguages: [],
    duplicates: { skills: 0, languages: 0 },
  };

  // Track which incoming items consumed
  for (const inc of incoming.experiences) {
    const idx = current.experiences.findIndex((cur) => isSameExperience(cur, inc));
    if (idx === -1) {
      plan.newExperiences.push(inc);
    } else {
      const before = current.experiences[idx];
      const after = mergeExperience(before, inc);
      const beforeBullets = new Set(
        (before.bullet_points ?? []).map((b) => normalizeStr(b))
      );
      const afterBullets = after.bullet_points ?? [];
      const newBullets = afterBullets.filter(
        (b) => !beforeBullets.has(normalizeStr(b))
      );
      const beforeSkills = new Set(
        (before.skills_used ?? []).map((s) => normalizeStr(s))
      );
      const newSkills = (after.skills_used ?? []).filter(
        (s) => !beforeSkills.has(normalizeStr(s))
      );
      // Only mark as enriched if there's actually something new
      if (newBullets.length > 0 || newSkills.length > 0 ||
          (after.description ?? "") !== (before.description ?? "") ||
          after.start_date !== before.start_date ||
          after.end_date !== before.end_date) {
        plan.enrichedExperiences.push({ index: idx, before, after, newBullets, newSkills });
      }
    }
  }

  for (const inc of incoming.educations) {
    const idx = current.educations.findIndex((cur) => isSameEducation(cur, inc));
    if (idx === -1) {
      plan.newEducations.push(inc);
    } else {
      const before = current.educations[idx];
      const after = mergeEducation(before, inc);
      const beforeBullets = new Set(
        ((before as any).bullet_points ?? []).map((b: string) => normalizeStr(b))
      );
      const newBullets = ((after as any).bullet_points ?? []).filter(
        (b: string) => !beforeBullets.has(normalizeStr(b))
      );
      if (newBullets.length > 0 ||
          (after.description ?? "") !== (before.description ?? "")) {
        plan.enrichedEducations.push({ index: idx, before, after, newBullets });
      }
    }
  }

  // Skills: dedupe by normalized name
  const skillSeen = new Set(current.skills.map(skillKey));
  for (const s of incoming.skills) {
    if (skillSeen.has(skillKey(s))) plan.duplicates.skills++;
    else {
      plan.newSkills.push(s);
      skillSeen.add(skillKey(s));
    }
  }

  // Languages: same
  const langSeen = new Set(current.languages.map(langKey));
  for (const l of incoming.languages) {
    if (langSeen.has(langKey(l))) plan.duplicates.languages++;
    else {
      plan.newLanguages.push(l);
      langSeen.add(langKey(l));
    }
  }

  return plan;
}

/**
 * Apply the merge plan, returning the new ProfileFull.
 */
export function applyMerge(current: ProfileFull, plan: MergePlan): ProfileFull {
  const experiences = [...current.experiences];
  for (const enr of plan.enrichedExperiences) experiences[enr.index] = enr.after;
  experiences.push(...plan.newExperiences);
  experiences.sort((a, b) => {
    const aEnd = a.end_date === "present" ? "9999-12" : a.end_date ?? a.start_date ?? "0000-00";
    const bEnd = b.end_date === "present" ? "9999-12" : b.end_date ?? b.start_date ?? "0000-00";
    return bEnd.localeCompare(aEnd);
  });

  const educations = [...current.educations];
  for (const enr of plan.enrichedEducations) educations[enr.index] = enr.after;
  educations.push(...plan.newEducations);

  const skills = [...current.skills, ...plan.newSkills];

  const languages = [...current.languages];
  for (const l of plan.newLanguages) languages.push(l);

  return {
    ...current,
    experiences,
    educations,
    skills,
    languages,
  };
}

/**
 * High-level merge: plan + apply. Convenience wrapper.
 */
export function mergeProfile(current: ProfileFull, incoming: ProfileFull): ProfileFull {
  const plan = planMerge(current, incoming);
  const merged = applyMerge(current, plan);
  return {
    ...merged,
    raw_cv_text: [current.raw_cv_text, incoming.raw_cv_text].filter(Boolean).join("\n\n---\n\n"),
  };
}

/**
 * Backwards-compat alias for the old API. Returns the legacy diff shape used by the upload UI.
 */
export type MergeDiff = {
  newExperiences: Experience[];
  newEducations: Education[];
  newSkills: Skill[];
  newLanguages: Language[];
  duplicates: { experiences: number; educations: number; skills: number; languages: number };
};
export function diffProfile(current: ProfileFull, incoming: ProfileFull): MergeDiff {
  const plan = planMerge(current, incoming);
  return {
    newExperiences: plan.newExperiences,
    newEducations: plan.newEducations,
    newSkills: plan.newSkills,
    newLanguages: plan.newLanguages,
    duplicates: {
      experiences: plan.enrichedExperiences.length,
      educations: plan.enrichedEducations.length,
      skills: plan.duplicates.skills,
      languages: plan.duplicates.languages,
    },
  };
}

// =============================================================
// Cleanup (de-dup an existing profile in place)
// =============================================================

export type CleanupReport = {
  experiencesMerged: number;
  educationsMerged: number;
  skillsRemoved: number;
};

/**
 * Scan a profile for near-duplicate experiences/educations/skills and merge them.
 * Returns the cleaned profile + a count of operations.
 */
export function dedupProfile(profile: ProfileFull): { profile: ProfileFull; report: CleanupReport } {
  const report: CleanupReport = {
    experiencesMerged: 0,
    educationsMerged: 0,
    skillsRemoved: 0,
  };

  // Experiences
  const exp: Experience[] = [];
  for (const e of profile.experiences) {
    const idx = exp.findIndex((existing) => isSameExperience(existing, e));
    if (idx === -1) exp.push(e);
    else {
      exp[idx] = mergeExperience(exp[idx], e);
      report.experiencesMerged++;
    }
  }
  exp.sort((a, b) => {
    const aEnd = a.end_date === "present" ? "9999-12" : a.end_date ?? a.start_date ?? "0000-00";
    const bEnd = b.end_date === "present" ? "9999-12" : b.end_date ?? b.start_date ?? "0000-00";
    return bEnd.localeCompare(aEnd);
  });

  // Educations
  const edu: Education[] = [];
  for (const e of profile.educations) {
    const idx = edu.findIndex((existing) => isSameEducation(existing, e));
    if (idx === -1) edu.push(e);
    else {
      edu[idx] = mergeEducation(edu[idx], e);
      report.educationsMerged++;
    }
  }

  // Skills — strict normalized dedup
  const skillMap = new Map<string, Skill>();
  for (const s of profile.skills) {
    const k = skillKey(s);
    if (!k) continue;
    const existing = skillMap.get(k);
    if (!existing) skillMap.set(k, { ...s });
    else {
      report.skillsRemoved++;
      existing.category = existing.category ?? s.category;
      existing.level = pickHigherSkillLevel(existing.level, s.level);
      // Merge evidence_experience_ids
      const evidence = new Set([
        ...(existing.evidence_experience_ids ?? []),
        ...(s.evidence_experience_ids ?? []),
      ]);
      existing.evidence_experience_ids = Array.from(evidence);
    }
  }
  const skills = Array.from(skillMap.values());

  // Languages
  const langMap = new Map<string, Language>();
  for (const l of profile.languages) {
    const k = langKey(l);
    if (!k) continue;
    const existing = langMap.get(k);
    if (!existing) langMap.set(k, { ...l });
    else existing.level = pickHigherLangLevel(existing.level ?? null, l.level ?? null);
  }
  const languages = Array.from(langMap.values());

  return {
    profile: {
      ...profile,
      experiences: exp,
      educations: edu,
      skills,
      languages,
    },
    report,
  };
}

// ---------------------------------------------------------------------------
// Identité : le merge n'écrase JAMAIS une identité déjà renseignée, mais il
// doit remplir celle qui ne l'est pas. Sans ça, un utilisateur qui enrichit le
// profil de démonstration avec « + Ajouter un CV » gardait « Profil de
// démarrage » et un email vide — et générait des CV sans nom ni coordonnées,
// donc impossibles à recontacter (bug observé sur des candidatures réelles).
// ---------------------------------------------------------------------------

/** Champs d'identité repris de l'entrant uniquement s'ils manquent côté profil. */
const IDENTITY_FIELDS = [
  "full_name",
  "email",
  "phone",
  "location",
  "linkedin_url",
  "portfolio_url",
] as const;

/** Valeurs semées par le profil de démonstration : à traiter comme « vide ». */
const PLACEHOLDER_FULL_NAME = /^profil de d[ée]marrage$/i;
const PLACEHOLDER_SUMMARY = /^profil de d[ée]monstration/i;

function isBlankValue(v: unknown): boolean {
  return v === null || v === undefined || String(v).trim() === "";
}

/**
 * Complète l'identité et le résumé du profil fusionné à partir du CV entrant.
 * Ne remplace que ce qui est vide ou reconnu comme valeur de démonstration.
 * Renvoie la liste des champs effectivement remplis (pour l'affichage).
 */
export function fillMissingIdentity(
  merged: ProfileFull,
  incoming: ProfileFull
): { profile: ProfileFull; filled: string[] } {
  const profile: ProfileFull = { ...merged };
  const filled: string[] = [];

  for (const field of IDENTITY_FIELDS) {
    const currentValue = profile[field];
    const incomingValue = incoming[field];
    const isPlaceholder =
      field === "full_name" && typeof currentValue === "string" && PLACEHOLDER_FULL_NAME.test(currentValue.trim());
    if ((isBlankValue(currentValue) || isPlaceholder) && !isBlankValue(incomingValue)) {
      (profile as Record<string, unknown>)[field] = incomingValue;
      filled.push(field);
    }
  }

  const summaryIsPlaceholder =
    typeof profile.summary === "string" && PLACEHOLDER_SUMMARY.test(profile.summary.trim());
  if ((isBlankValue(profile.summary) || summaryIsPlaceholder) && !isBlankValue(incoming.summary)) {
    profile.summary = incoming.summary;
    filled.push("summary");
  }

  return { profile, filled };
}
