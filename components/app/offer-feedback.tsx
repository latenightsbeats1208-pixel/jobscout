"use client";
import { useCallback, useEffect, useId, useState } from "react";
import { ThumbsDown, ThumbsUp } from "lucide-react";
import { Chip } from "@/components/ui/chip";
import { cn } from "@/lib/utils";
import {
  FEEDBACK_EVENT,
  FEEDBACK_REASONS,
  MIN_FEEDBACK_PER_SIDE,
  feedbackReasonLabel,
  type FeedbackEventDetail,
  type FeedbackStats,
  type FeedbackVerdict,
  type OfferFeedback,
} from "@/lib/feedback";

/**
 * 👍 « Pour moi » / 👎 « Pas pour moi » sur une offre, avec un motif facultatif
 * pour le 👎. Recliquer sur l'avis choisi le retire. Chaque avis sert à mesurer
 * si la note range bien les offres (voir FeedbackSummary).
 */
export function OfferFeedbackControl({ offerId, initial }: { offerId: number; initial: OfferFeedback | null }) {
  const [feedback, setFeedback] = useState<OfferFeedback | null>(initial);
  const [error, setError] = useState(false);
  const labelId = useId();

  // Changement d'offre dans l'aperçu : on repart de l'avis de la nouvelle offre.
  useEffect(() => {
    setFeedback(initial);
    setError(false);
  }, [offerId, initial?.verdict, initial?.reason]); // eslint-disable-line react-hooks/exhaustive-deps

  async function save(next: OfferFeedback | null) {
    const previous = feedback;
    setFeedback(next);
    setError(false);
    try {
      const res = await fetch(`/api/offres/${offerId}/feedback`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(next ?? { verdict: null }),
      });
      if (!res.ok) throw new Error("avis refusé");
      window.dispatchEvent(new CustomEvent<FeedbackEventDetail>(FEEDBACK_EVENT, { detail: { offerId, feedback: next } }));
    } catch {
      setFeedback(previous);
      setError(true);
    }
  }

  const toggle = (verdict: FeedbackVerdict) => save(feedback?.verdict === verdict ? null : { verdict, reason: null });
  const button = (active: boolean) =>
    cn(
      "inline-flex h-11 flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-full border px-3 text-small font-semibold transition-colors duration-200",
      active ? "border-accent bg-accent text-onAccent hover:bg-accentHover" : "border-border text-text hover:bg-surfaceHover"
    );

  return (
    <div>
      <p id={labelId} className="text-small font-semibold">Cette offre est-elle pour vous ?</p>
      <div role="group" aria-labelledby={labelId} className="mt-2 flex gap-2">
        <button type="button" aria-pressed={feedback?.verdict === "up"} onClick={() => toggle("up")} className={button(feedback?.verdict === "up")}>
          <ThumbsUp className="h-4 w-4" aria-hidden="true" /> Pour moi
        </button>
        <button type="button" aria-pressed={feedback?.verdict === "down"} onClick={() => toggle("down")} className={button(feedback?.verdict === "down")}>
          <ThumbsDown className="h-4 w-4" aria-hidden="true" /> Pas pour moi
        </button>
      </div>
      {feedback?.verdict === "down" && (
        <div className="mt-3">
          <p className="text-caption text-textSecondary">Pourquoi ? Facultatif, mais c&apos;est ce qui dit quel critère de la note s&apos;est trompé.</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {FEEDBACK_REASONS.map((r) => (
              <Chip
                key={r.id}
                active={feedback.reason === r.id}
                onClick={() => save({ verdict: "down", reason: feedback.reason === r.id ? null : r.id })}
              >
                {r.label}
              </Chip>
            ))}
          </div>
        </div>
      )}
      {error && <p role="alert" className="mt-2 text-small text-danger">L&apos;avis n&apos;a pas pu être enregistré. Réessayez.</p>}
    </div>
  );
}

const pct = (x: number) => `${Math.round(x * 100)} %`;

/**
 * Ce que disent les avis de la note : part des paires (👍, 👎) qu'elle range
 * dans le bon ordre. Mise à jour à chaque avis donné sur la page.
 */
export function FeedbackSummary({ className }: { className?: string }) {
  const [stats, setStats] = useState<FeedbackStats | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/offres/feedback/stats", { cache: "no-store" });
      if (res.ok) setStats((await res.json()) as FeedbackStats);
    } catch {
      // Mesure indisponible : la ligne reste telle quelle, rien d'autre n'en dépend.
    }
  }, []);

  useEffect(() => {
    load();
    window.addEventListener(FEEDBACK_EVENT, load);
    return () => window.removeEventListener(FEEDBACK_EVENT, load);
  }, [load]);

  if (!stats) return null;
  const ups = stats.up + stats.implicitUp;
  let text: string;
  if (ups + stats.down === 0) {
    text = "Dites « pour moi » ou « pas pour moi » sur quelques offres : JobScout mesurera si sa note les range dans le bon ordre.";
  } else {
    text = `Vos avis : ${ups} 👍${stats.implicitUp ? ` (dont ${stats.implicitUp} candidature${stats.implicitUp > 1 ? "s" : ""})` : ""} · ${stats.down} 👎`;
    if (stats.agreement === null) {
      const missing = [
        ups < MIN_FEEDBACK_PER_SIDE ? `${MIN_FEEDBACK_PER_SIDE - ups} 👍` : null,
        stats.down < MIN_FEEDBACK_PER_SIDE ? `${MIN_FEEDBACK_PER_SIDE - stats.down} 👎` : null,
      ].filter(Boolean);
      text += ` — encore ${missing.join(" et ")} pour mesurer la note.`;
    } else {
      text += ` — la note place une offre 👍 devant une offre 👎 dans ${pct(stats.agreement)} des cas`;
      if (stats.agreementLocal !== null) text += ` (${pct(stats.agreementLocal)} sans la relecture par l'IA)`;
      text += ".";
    }
    if (stats.reasons.length) {
      text += ` Motifs des 👎 : ${stats.reasons
        .slice(0, 3)
        .map((r) => `${feedbackReasonLabel(r.id) ?? r.id} ×${r.count}`)
        .join(", ")}.`;
    }
  }
  return (
    <p role="status" className={cn("text-small text-textSecondary", className)}>
      {text}
    </p>
  );
}
