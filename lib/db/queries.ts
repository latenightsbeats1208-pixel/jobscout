import "server-only";
import { getDb, parseJson, asJson, transaction } from "./index";
import type { ProfileFull, Profile, Experience, Education, Skill, Language } from "@/lib/cv/types";

export function getProfile(): ProfileFull | null {
  const db = getDb();
  const profile = db.prepare("SELECT * FROM profile ORDER BY id ASC LIMIT 1").get() as
    | (Omit<Profile, "sectors" | "target_countries" | "sources_enabled" | "preferred_contracts"> & {
        sectors: string;
        target_countries: string;
        sources_enabled: string;
        preferred_contracts: string;
      })
    | undefined;
  if (!profile) return null;

  // `id` est optionnel dans le schéma zod (il n'existe pas encore avant l'insertion),
  // mais toute ligne relue de la base en possède un : on le vérifie plutôt que de forcer.
  const id = profile.id;
  if (typeof id !== "number") {
    throw new Error("Profil corrompu : identifiant manquant en base.");
  }
  const experiences = db
    .prepare("SELECT * FROM experiences WHERE profile_id = ? ORDER BY position_index ASC")
    .all(id) as (Omit<Experience, "bullet_points" | "skills_used"> & {
    bullet_points: string;
    skills_used: string;
  })[];
  const educations = (
    db
      .prepare("SELECT * FROM educations WHERE profile_id = ? ORDER BY position_index ASC")
      .all(id) as Education[]
  ).map((e) => ({ ...e }));
  const skills = db
    .prepare("SELECT * FROM skills WHERE profile_id = ?")
    .all(id) as (Omit<Skill, "evidence_experience_ids"> & { evidence_experience_ids: string })[];
  const languages = (
    db.prepare("SELECT * FROM languages WHERE profile_id = ?").all(id) as Language[]
  ).map((l) => ({ ...l }));

  return {
    ...profile,
    sectors: parseJson(profile.sectors, []),
    target_countries: parseJson(profile.target_countries, []),
    sources_enabled: parseJson(profile.sources_enabled, []),
    preferred_contracts: parseJson(profile.preferred_contracts, ["cdi", "cdd"]),
    experiences: experiences.map((e) => ({
      ...e,
      bullet_points: parseJson(e.bullet_points, []),
      skills_used: parseJson(e.skills_used, []),
    })),
    educations,
    skills: skills.map((s) => ({
      ...s,
      evidence_experience_ids: parseJson(s.evidence_experience_ids, []),
    })),
    languages,
  };
}

export function saveProfile(input: Omit<ProfileFull, "id" | "created_at" | "updated_at">): number {
  const db = getDb();
  return transaction(() => {
    db.prepare("DELETE FROM profile").run();
    const result = db
      .prepare(
        `INSERT INTO profile (full_name, email, phone, location, linkedin_url, portfolio_url, summary, raw_cv_text, sectors, target_countries, sources_enabled, preferred_contracts, extraction_confidence)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.full_name ?? null,
        input.email ?? null,
        input.phone ?? null,
        input.location ?? null,
        input.linkedin_url ?? null,
        input.portfolio_url ?? null,
        input.summary ?? null,
        input.raw_cv_text ?? null,
        asJson(input.sectors ?? []),
        asJson(input.target_countries ?? []),
        asJson(input.sources_enabled ?? []),
        asJson(input.preferred_contracts ?? ["cdi", "cdd"]),
        input.extraction_confidence ?? 0
      );
    const profileId = Number(result.lastInsertRowid);

    const insExp = db.prepare(
      `INSERT INTO experiences (profile_id, title, company, location, start_date, end_date, description, bullet_points, skills_used, position_index)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    input.experiences.forEach((e, i) =>
      insExp.run(
        profileId,
        e.title,
        e.company ?? null,
        e.location ?? null,
        e.start_date ?? null,
        e.end_date ?? null,
        e.description ?? null,
        asJson(e.bullet_points ?? []),
        asJson(e.skills_used ?? []),
        i
      )
    );

    const insEdu = db.prepare(
      `INSERT INTO educations (profile_id, school, degree, field, location, start_date, end_date, description, position_index)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    input.educations.forEach((e, i) =>
      insEdu.run(
        profileId,
        e.school,
        e.degree ?? null,
        e.field ?? null,
        e.location ?? null,
        e.start_date ?? null,
        e.end_date ?? null,
        e.description ?? null,
        i
      )
    );

    const insSkill = db.prepare(
      `INSERT INTO skills (profile_id, name, category, level, evidence_experience_ids)
       VALUES (?, ?, ?, ?, ?)`
    );
    input.skills.forEach((s) =>
      insSkill.run(
        profileId,
        s.name,
        s.category ?? null,
        s.level ?? null,
        asJson(s.evidence_experience_ids ?? [])
      )
    );

    const insLang = db.prepare(`INSERT INTO languages (profile_id, name, level) VALUES (?, ?, ?)`);
    input.languages.forEach((l) => insLang.run(profileId, l.name, l.level ?? null));

    return profileId;
  });
}
