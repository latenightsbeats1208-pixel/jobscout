/**
 * Avis de l'utilisateur sur une offre. Partagé entre le serveur et l'interface.
 *
 * 👍 « Pour moi » : l'offre mérite une candidature.
 * 👎 « Pas pour moi », avec un motif facultatif : c'est le motif qui dit quel
 * critère de la note s'est trompé (métier, compétences, expérience…).
 */

export type FeedbackVerdict = "up" | "down";

export type OfferFeedback = { verdict: FeedbackVerdict; reason: string | null };

export const FEEDBACK_REASONS = [
  { id: "metier", label: "Pas mon métier" },
  { id: "competences", label: "Compétences manquantes" },
  { id: "trop_senior", label: "Trop senior" },
  { id: "trop_junior", label: "Trop junior" },
  { id: "lieu", label: "Lieu" },
  { id: "contrat", label: "Contrat" },
  { id: "langue", label: "Langue" },
  { id: "annonce_erronee", label: "Annonce erronée" },
  { id: "autre", label: "Autre" },
] as const;

export type FeedbackReason = (typeof FEEDBACK_REASONS)[number]["id"];

export function isFeedbackReason(value: unknown): value is FeedbackReason {
  return FEEDBACK_REASONS.some((r) => r.id === value);
}

export function feedbackReasonLabel(id: string | null): string | null {
  return FEEDBACK_REASONS.find((r) => r.id === id)?.label ?? null;
}

/** Événement navigateur émis après chaque avis : la liste et la mesure se mettent à jour. */
export const FEEDBACK_EVENT = "jobscout:feedback";
export type FeedbackEventDetail = { offerId: number; feedback: OfferFeedback | null };

export type FeedbackStats = {
  up: number;
  /** Offres sans avis mais avec une candidature : comptées comme 👍. */
  implicitUp: number;
  down: number;
  /** Part des paires (👍, 👎) où la note affichée place le 👍 devant ; null tant qu'il y a trop peu d'avis. */
  agreement: number | null;
  /** Même mesure avec la seule note locale, quand une relecture par l'IA a modifié la note d'une offre jugée. */
  agreementLocal: number | null;
  reviewedJudged: number;
  /** Motifs des 👎, du plus fréquent au moins fréquent. */
  reasons: { id: string; count: number }[];
};

/** En dessous, la mesure dépend de trop peu d'avis pour vouloir dire quelque chose. */
export const MIN_FEEDBACK_PER_SIDE = 5;
