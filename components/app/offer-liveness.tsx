"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, RotateCcw } from "lucide-react";
import { fromSqliteUtc } from "@/lib/utils";
import { RelativeTime } from "@/components/ui/relative-time";

type LivenessState = { checkable: boolean; closed_at: string | null; checked_at: string | null };

/**
 * L'annonce est-elle toujours en ligne ? Vérifiée à l'ouverture de la page (le
 * serveur ne revérifie pas une offre vue il y a moins de 6 h) : préparer un
 * dossier pour un poste déjà pourvu est le coût que cela évite.
 */
export function OfferLiveness({ offreId, sourceLabel, initial }: { offreId: number; sourceLabel: string; initial: LivenessState }) {
  const [state, setState] = useState(initial);
  const [checking, setChecking] = useState(false);
  const [failed, setFailed] = useState(false);

  async function check(force: boolean) {
    setChecking(true);
    setFailed(false);
    try {
      const res = await fetch(`/api/offres/${offreId}/liveness`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ force }),
      });
      if (!res.ok) throw new Error();
      setState((await res.json()) as LivenessState);
    } catch {
      setFailed(true);
    } finally {
      setChecking(false);
    }
  }

  useEffect(() => {
    if (initial.checkable) void check(false);
    // Une seule vérification à l'ouverture de la page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offreId]);

  if (!state.checkable) return null;

  if (state.closed_at) {
    return (
      <div role="status" className="mt-5 flex items-start gap-3 rounded-lg border border-warning/40 bg-warning/10 p-4">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-warning" />
        <div className="min-w-0 text-small">
          <p className="font-semibold">Offre retirée par {sourceLabel}</p>
          <p className="mt-1 text-textSecondary">
            L&apos;annonce n&apos;est plus en ligne (<RelativeTime iso={fromSqliteUtc(state.closed_at)} />) : le poste est sans doute pourvu.
            Inutile d&apos;y préparer une candidature.
          </p>
          <button type="button" onClick={() => check(true)} disabled={checking} className="mt-2 inline-flex items-center gap-1.5 font-semibold text-accent hover:underline disabled:opacity-50">
            <RotateCcw className="h-3.5 w-3.5" /> {checking ? "Vérification…" : "Vérifier à nouveau"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <p className="mt-4 inline-flex items-center gap-1.5 text-caption text-textSecondary" aria-live="polite">
      {checking && !state.checked_at ? (
        "Vérification de l'annonce…"
      ) : state.checked_at ? (
        <>
          <CheckCircle2 className="h-3.5 w-3.5 text-success" />
          <span>Toujours en ligne sur {sourceLabel} · vérifiée <RelativeTime iso={fromSqliteUtc(state.checked_at)} /></span>
        </>
      ) : failed ? (
        `Impossible de vérifier que l'annonce est toujours sur ${sourceLabel}.`
      ) : null}
    </p>
  );
}
