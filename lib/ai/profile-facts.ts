import "server-only";
import type { ProfileFull } from "@/lib/cv/types";

/**
 * Digest FACTUEL du profil, injecté dans les prompts de génération et de
 * relecture : chaque expérience avec ses dates, sa description, ses puces et
 * SES outils. C'est la seule source autorisée pour les affirmations d'une
 * lettre — sans lui, le modèle ne recevait que des intitulés et inventait
 * budgets, prospections et cahiers des charges pour remplir.
 */
export function profileFacts(profile: ProfileFull): string {
  const lines: string[] = [];
  lines.push(`Candidat : ${profile.full_name ?? ""}${profile.location ? ` — ${profile.location}` : ""}`);
  if (profile.summary) lines.push(`Résumé : ${profile.summary}`);
  lines.push("Expériences (de la plus récente à la plus ancienne) :");
  for (const e of profile.experiences) {
    lines.push(`- ${e.title}${e.company ? ` — ${e.company}` : ""} (${e.start_date ?? "?"} → ${e.end_date ?? "?"})`);
    if (e.description) lines.push(`  Description : ${e.description}`);
    for (const b of e.bullet_points ?? []) lines.push(`  • ${b}`);
    if (e.skills_used?.length) lines.push(`  Outils/plateformes de CETTE expérience : ${e.skills_used.join(", ")}`);
  }
  lines.push("Formations :");
  for (const ed of profile.educations) {
    lines.push(
      `- ${[ed.degree, ed.field].filter(Boolean).join(" — ")} — ${ed.school} (${ed.start_date ?? "?"} → ${ed.end_date ?? "?"})${ed.description ? ` : ${ed.description}` : ""}`
    );
  }
  lines.push(`Compétences déclarées : ${profile.skills.map((s) => s.name).join(", ")}`);
  lines.push(`Langues : ${profile.languages.map((l) => `${l.name} ${l.level ?? ""}`.trim()).join(", ")}`);
  return lines.join("\n");
}
