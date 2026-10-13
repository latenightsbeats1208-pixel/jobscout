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
export const REVIEW_VERSION = "review-v6";

export type Coverage = "oui" | "partiel" | "non";
export type Verdict = "postuler" | "a_tenter" | "hors_profil";
/**
 * Nature d'une exigence. Seules les compétences (savoir-faire, outils,
 * méthodes, habilitations, certifications) décident du filtre : les années
 * d'expérience et les langues sont déjà filtrées localement sur des phrases
 * explicites, un diplôme s'accompagne souvent d'un « ou équivalent », et une
 * condition administrative (permis, véhicule, astreintes…) est rarement écrite
 * dans un CV — son absence ne prouve rien.
 */
export type RequirementKind = "competence" | "diplome" | "experience" | "langue" | "administratif";
export type MustHave = {
  requirement: string;
  covered: Coverage;
  kind: RequirementKind;
  /** Mots de l'annonce qui portent l'exigence, cités par le modèle. */
  citation: string;
  /**
   * La citation se retrouve dans l'annonce. Une exigence non vérifiée a été
   * DÉDUITE (de l'intitulé, le plus souvent) : elle est affichée, mais ne
   * filtre pas et ne compte pas dans la part de compétences couvertes.
   */
  verified: boolean;
};

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
  administratif: "administratif", administrative: "administratif", admin: "administratif",
};

/**
 * Filet de sécurité si le modèle classe quand même un permis en compétence.
 * Volontairement étroit : « véhiculé » (avoir sa voiture), pas « véhicule »,
 * pour que « simulation numérique de véhicules » reste une compétence.
 */
const ADMINISTRATIVE =
  /(?<![\p{L}])(?:permis|v[ée]hicul[ée]e?s?(?<!v[ée]hicules?)|casier judiciaire|autorisation de travail|astreintes?|driving licen[cs]e|driver'?s licen[cs]e)(?![\p{L}])/iu;

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
/** Mots (2 lettres et plus) d'un texte, sans accents ni ponctuation. */
function words(text: string): string[] {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .split(/[^a-z0-9+#]+/)
    .filter((w) => w.length >= 2);
}

/**
 * La citation est-elle dans l'annonce ? 80 % de ses mots au moins doivent s'y
 * trouver : le modèle recopie rarement à la virgule près (accents, pluriels,
 * ponctuation), mais une exigence inventée ne passe pas.
 */
export function isCitationInAd(citation: string, adWords: Set<string>): boolean {
  const cited = words(citation);
  if (!cited.length) return false;
  const found = cited.filter((w) => adWords.has(w) || (w.length > 4 && adWords.has(w.replace(/s$/, "")))).length;
  return found / cited.length >= 0.8;
}

export function parseReview(
  raw: unknown,
  meta: { profile_hash: string; offer_hash: string; model: string },
  /** Titre et description de l'annonce relue : de quoi vérifier les citations. */
  ad: { title: string; description_text: string }
): AiReview | null {
  const adWords = new Set(words(`${ad.title} ${ad.description_text}`));
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
      let kind = KINDS[String(x.kind ?? "").toLowerCase()] ?? "competence";
      if (kind === "competence" && ADMINISTRATIVE.test(requirement)) kind = "administratif";
      const citation = typeof x.citation === "string" ? x.citation.trim().slice(0, 160) : "";
      return requirement && covered
        ? { requirement: requirement.slice(0, 80), covered, kind, citation, verified: isCitationInAd(citation, adWords) }
        : null;
    })
    .filter((m): m is MustHave => m !== null)
    .slice(0, 8);
  // Seules les compétences ÉCRITES dans l'annonce comptent : une exigence déduite ne prouve rien.
  const skills = must_haves.filter((m) => m.kind === "competence" && m.verified);
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

/**
 * Ce que la relecture fait de la note : la note locale reste, le verdict la
 * réduit. Mesuré en octobre 2026 avec de vraies relectures (Gemini) :
 *
 * - Remplacer la note locale par celle de l'IA, avec un filtre « compétences
 *   indispensables absentes », faisait passer le NDCG@20 de 80 % à 69 % sur
 *   l'ancien banc et de 87 % à 83 % sur le banc marché (16 profils) : presque
 *   toutes les bonnes offres sortaient à 100, ex æquo, sans plus rien pour
 *   départager contrat, zone ou intitulé ; et le filtre écartait 20 offres
 *   jugées bonnes pour un « Spotfire » ou un « HTML et CSS » manquant.
 * - Réduite par le verdict, avec la consigne review-v5 (un outil manquant ne
 *   fait plus « hors profil ») : 80 % sur l'ancien banc (80 % sans IA), 89 %
 *   sur le banc marché (87 % sans IA), une offre hors sujet dans le top 10
 *   pour 16 profils au lieu de 6. Plat de 0,8 à 0,9 et de 0,5 à 0,7.
 */
const VERDICT_FACTOR: Record<Verdict, number> = {
  postuler: 1,
  a_tenter: 0.85,
  hors_profil: 0.6,
};

/**
 * Même métier, autre spécialité ou autre cadre (role_fit sous 90 depuis la
 * consigne review-v6) : une infirmière des urgences devant un poste en EHPAD, un
 * cuisinier de restaurant devant une cuisine de collectivité. Sur le banc
 * marché, le chef de partie passe de 74 % à 82 % et l'infirmière de 80 % à 85 %
 * (NDCG@20) ; moyenne 89 %, ancien banc 81 % (80 % sans IA). Plat de 0,85 à 0,95.
 */
const OTHER_SPECIALTY_FACTOR = 0.88;

export function aiFactor(r: AiReview): number {
  return VERDICT_FACTOR[r.verdict] * (r.role_fit >= 90 ? 1 : OTHER_SPECIALTY_FACTOR);
}

/**
 * Une relecture ne sert que si au moins une exigence est écrite dans l'annonce.
 * Sinon (annonce de trois lignes, ou qui ne parle que de l'entreprise), le
 * modèle n'a fait que deviner : la note locale reste en place.
 */
export function isReviewUsable(r: AiReview): boolean {
  return r.must_haves.some((m) => m.verified);
}
