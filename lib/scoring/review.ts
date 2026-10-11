import { createHash } from "node:crypto";
import type { ProfileFull } from "@/lib/cv/types";

/**
 * Relecture par l'IA d'une offre : ce que la note locale ne sait pas faire,
 * juger si le profil COUVRE les exigences indispensables de l'annonce, même
 * quand elle les décrit en phrases (« rédaction des cahiers de test » = recette).
 *
 * Ce module ne parle pas au réseau : il valide la réponse du modèle, la
 * traduit en note et en filtre, et dit si une relecture en cache est encore
 * valable. L'appel au modèle vit dans lib/ai/review-offres.ts.
 */

/** À changer à chaque modification du prompt ou du barème : les relectures antérieures sont alors refaites. */
export const REVIEW_VERSION = "review-v2";

export type Coverage = "oui" | "partiel" | "non";
export type Verdict = "postuler" | "a_tenter" | "hors_profil";
/**
 * Nature d'une exigence. Seules les compétences (savoir-faire, outils,
 * méthodes, habilitations, certifications) décident du filtre : les années
 * d'expérience et les langues sont déjà filtrées localement sur des phrases
 * explicites, et un diplôme s'accompagne souvent d'un « ou équivalent ».
 */
export type RequirementKind = "competence" | "diplome" | "experience" | "langue";
export type MustHave = { requirement: string; covered: Coverage; kind: RequirementKind };

export type AiReview = {
  version: string;
  /** Empreinte du profil relu : une relecture faite pour un autre profil ne vaut plus. */
  profile_hash: string;
  /** Empreinte de l'annonce relue : une annonce modifiée depuis est relue à nouveau. */
  offer_hash: string;
  model: string;
  reviewed_at: string;
  must_haves: MustHave[];
  /** Part des COMPÉTENCES indispensables couvertes, recalculée ici (oui = 1, partiel = ½). */
  skills_fit: number;
  /** Proximité avec le métier visé ou exercé, selon le modèle. */
  role_fit: number;
  verdict: Verdict;
  reason: string;
};

function sha(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16);
}

/** Ce que le modèle voit du profil : si l'un de ces champs change, les relectures sont refaites. */
export function profileHash(p: ProfileFull): string {
  return sha({
    titles: p.target_titles ?? [],
    summary: p.summary ?? "",
    exp: p.experiences.map((e) => [e.title, e.company, e.start_date, e.end_date, e.bullet_points, e.skills_used]),
    edu: p.educations.map((e) => [e.degree, e.field]),
    skills: p.skills.map((s) => s.name),
    langs: p.languages.map((l) => [l.name, l.level]),
  });
}

export function offerHash(o: { title: string; description_text: string }): string {
  return sha([o.title, o.description_text]);
}

export function isReviewCurrent(
  r: AiReview | null | undefined,
  profile: string,
  offer: string
): r is AiReview {
  return !!r && r.version === REVIEW_VERSION && r.profile_hash === profile && r.offer_hash === offer;
}

const KINDS: Record<string, RequirementKind> = {
  competence: "competence", "compétence": "competence", skill: "competence",
  diplome: "diplome", "diplôme": "diplome", degree: "diplome",
  experience: "experience", "expérience": "experience",
  langue: "langue", language: "langue",
};

const COVERAGE: Record<string, Coverage> = { oui: "oui", yes: "oui", partiel: "partiel", partial: "partiel", non: "non", no: "non" };
const VERDICTS: Record<string, Verdict> = {
  postuler: "postuler", apply: "postuler",
  a_tenter: "a_tenter", "à_tenter": "a_tenter", stretch: "a_tenter",
  hors_profil: "hors_profil", mismatch: "hors_profil",
};

const clamp = (n: unknown, lo = 0, hi = 100): number =>
  typeof n === "number" && Number.isFinite(n) ? Math.max(lo, Math.min(hi, Math.round(n))) : lo;

/**
 * Réponse du modèle pour UNE offre → relecture validée, ou null si elle est
 * inexploitable. La part de compétences couvertes est recalculée à partir des
 * exigences : on ne fait pas confiance à l'arithmétique du modèle.
 */
export function parseReview(
  raw: unknown,
  meta: { profile_hash: string; offer_hash: string; model: string }
): AiReview | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const verdict = VERDICTS[String(r.verdict ?? "").toLowerCase()];
  if (!verdict) return null;
  const must_haves = (Array.isArray(r.must_haves) ? r.must_haves : [])
    .map((m) => {
      const x = (m ?? {}) as Record<string, unknown>;
      const requirement = typeof x.requirement === "string" ? x.requirement.trim() : "";
      const covered = COVERAGE[String(x.covered ?? "").toLowerCase()];
      // Nature absente ou inconnue : compétence, le cas de loin le plus courant.
      const kind = KINDS[String(x.kind ?? "").toLowerCase()] ?? "competence";
      return requirement && covered ? { requirement: requirement.slice(0, 80), covered, kind } : null;
    })
    .filter((m): m is MustHave => m !== null)
    .slice(0, 8);
  const skills = must_haves.filter((m) => m.kind === "competence");
  const skills_fit = skills.length
    ? Math.round((100 * skills.reduce((s, m) => s + (m.covered === "oui" ? 1 : m.covered === "partiel" ? 0.5 : 0), 0)) / skills.length)
    : clamp(r.skills_fit ?? 50);
  return {
    version: REVIEW_VERSION,
    ...meta,
    reviewed_at: new Date().toISOString(),
    must_haves,
    skills_fit,
    role_fit: clamp(r.role_fit),
    verdict,
    reason: typeof r.reason === "string" ? r.reason.trim().slice(0, 240) : "",
  };
}

/** Bandes de note par verdict : le verdict ancre la note, les deux mesures la placent dans la bande. */
const BANDS: Record<Verdict, [number, number]> = {
  postuler: [70, 100],
  a_tenter: [40, 75],
  hors_profil: [0, 45],
};

/** Pertinence 0–100 d'une offre relue : compétences couvertes d'abord, métier ensuite. */
export function aiRelevance(r: AiReview): number {
  const raw = 0.6 * r.skills_fit + 0.4 * r.role_fit;
  const [lo, hi] = BANDS[r.verdict];
  return Math.max(lo, Math.min(hi, raw));
}

/**
 * Le filtre de compétences : hors critères quand le modèle juge l'offre hors
 * profil ET que moins de 40 % des COMPÉTENCES indispensables sont couvertes.
 * Un « hors profil » qui tient au métier, au diplôme ou aux années reste noté
 * bas sans être écarté.
 */
export function aiExclusion(r: AiReview): string | null {
  if (r.verdict !== "hors_profil" || r.skills_fit >= 40) return null;
  if (!r.must_haves.some((m) => m.kind === "competence")) return null;
  const missing = r.must_haves
    .filter((m) => m.kind === "competence" && m.covered === "non")
    .map((m) => m.requirement)
    .slice(0, 3);
  return `compétences indispensables absentes${missing.length ? ` : ${missing.join(", ")}` : ""}`;
}
