import "server-only";
import type { ExtractedCV } from "./types";
import type { ProfileFull } from "./types";

/**
 * Convertit la sortie Claude → ProfileFull, en :
 * - dédoublonnant les skills (case-insensitive)
 * - triant les expériences par date desc
 * - corrélant les skills avec leurs expériences (evidence_experience_ids)
 * - calculant le score de confiance d'extraction
 */
export function buildProfileFromExtraction(
  ex: ExtractedCV,
  rawCvText: string
): Omit<ProfileFull, "id" | "created_at" | "updated_at"> {
  // Sort experiences: most recent first
  const sortedExp = [...ex.experiences].sort((a, b) => {
    const aEnd = a.end_date === "present" ? "9999-12" : a.end_date ?? a.start_date ?? "0000-00";
    const bEnd = b.end_date === "present" ? "9999-12" : b.end_date ?? b.start_date ?? "0000-00";
    return bEnd.localeCompare(aEnd);
  });

  const experiences = sortedExp.map((e, idx) => ({
    title: e.title,
    company: e.company,
    location: e.location,
    start_date: e.start_date,
    end_date: e.end_date,
    description: e.description,
    bullet_points: e.bullet_points ?? [],
    skills_used: e.skills_used ?? [],
    // We tag with positional id for evidence linking (DB will assign real IDs after save)
    _idx: idx,
  }));

  // Dedupe skills, then resolve evidence_experience_ids by name match in skills_used
  const skillMap = new Map<string, { name: string; category: any; level: any; evidence: number[] }>();
  for (const s of ex.skills) {
    const key = s.name.trim().toLowerCase();
    if (!key) continue;
    if (!skillMap.has(key)) {
      skillMap.set(key, {
        name: s.name.trim(),
        category: s.category,
        level: s.level,
        evidence: [],
      });
    } else {
      // Keep highest level if both present
      const existing = skillMap.get(key)!;
      existing.category = existing.category ?? s.category;
      existing.level = pickHigherLevel(existing.level, s.level);
    }
  }
  // Also pull skills mentioned in skills_used that aren't in the global list
  for (const e of experiences) {
    for (const skill of e.skills_used) {
      const key = skill.trim().toLowerCase();
      if (!key) continue;
      if (!skillMap.has(key)) {
        skillMap.set(key, { name: skill.trim(), category: null, level: null, evidence: [] });
      }
      const entry = skillMap.get(key)!;
      if (!entry.evidence.includes(e._idx)) entry.evidence.push(e._idx);
    }
  }

  const skills = Array.from(skillMap.values()).map((s) => ({
    name: s.name,
    category: s.category,
    level: s.level,
    evidence_experience_ids: s.evidence, // positional indices, resolved at UI/scoring time
  }));

  const expCleaned = experiences.map(({ _idx, ...rest }) => rest);

  // Languages dedupe
  const langMap = new Map<string, { name: string; level: string | null }>();
  for (const l of ex.languages) {
    const key = l.name.trim().toLowerCase();
    if (!key) continue;
    if (!langMap.has(key)) langMap.set(key, { name: l.name.trim(), level: l.level });
  }

  // Educations dedupe by school+degree+start
  const eduSeen = new Set<string>();
  const educations = ex.educations.filter((e) => {
    const key = `${e.school}|${e.degree ?? ""}|${e.start_date ?? ""}`;
    if (eduSeen.has(key)) return false;
    eduSeen.add(key);
    return true;
  });

  return {
    full_name: ex.identity.full_name,
    email: ex.identity.email,
    phone: ex.identity.phone,
    location: ex.identity.location,
    linkedin_url: normalizeUrl(ex.identity.linkedin_url),
    portfolio_url: normalizeUrl(ex.identity.portfolio_url),
    summary: ex.summary,
    raw_cv_text: rawCvText,
    sectors: [],
    target_countries: [],
    sources_enabled: [],
    // Même défaut que le schéma zod, la colonne SQL et l'écran de préférences.
    preferred_contracts: ["cdi", "cdd"],
    extraction_confidence: computeConfidence(ex),
    experiences: expCleaned,
    educations,
    skills,
    languages: Array.from(langMap.values()),
  };
}

function normalizeUrl(url: string | null): string | null {
  if (!url) return null;
  if (/^https?:\/\//i.test(url)) return url;
  return `https://${url}`;
}

const LEVEL_ORDER: Record<string, number> = {
  beginner: 1,
  intermediate: 2,
  advanced: 3,
  expert: 4,
};
function pickHigherLevel(a: string | null, b: string | null): any {
  if (!a) return b;
  if (!b) return a;
  return (LEVEL_ORDER[a] ?? 0) >= (LEVEL_ORDER[b] ?? 0) ? a : b;
}

export function computeConfidence(ex: ExtractedCV): number {
  let score = 0;
  // Identity (max 30)
  if (ex.identity.full_name) score += 10;
  if (ex.identity.email) score += 10;
  if (ex.identity.phone) score += 5;
  if (ex.identity.location) score += 5;

  // Experiences with dates (max 30)
  const datedExp = ex.experiences.filter((e) => e.start_date || e.end_date).length;
  score += Math.min(30, datedExp * 10);

  // Skills (max 20)
  score += Math.min(20, ex.skills.length * 2);

  // Educations (max 10)
  score += Math.min(10, ex.educations.length * 5);

  // Bullet points (max 10) — sign of detailed extraction
  const bulletTotal = ex.experiences.reduce((s, e) => s + (e.bullet_points?.length ?? 0), 0);
  score += Math.min(10, bulletTotal);

  return Math.min(100, score);
}
