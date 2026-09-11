"use client";
import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";

type LlmStatus = {
  mode: "pack" | "byok" | "unset";
  configured: boolean;
  quota: {
    points_remaining: number | null;
    dossiers_estimes: number | null;
  } | null;
};

/**
 * Pied de barre latérale (patron version-badge) : quota du pack IA.
 * N'affiche rien hors mode pack ou si le proxy est injoignable — la barre
 * latérale reste sobre, jamais de message d'erreur ici.
 */
export function QuotaBadge() {
  const [status, setStatus] = useState<LlmStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/settings/llm", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: LlmStatus | null) => {
        if (!cancelled && d) setStatus(d);
      })
      .catch(() => {
        /* hors-ligne : rien à signaler */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (status?.mode !== "pack" || !status.configured || !status.quota) return null;
  const { points_remaining, dossiers_estimes } = status.quota;
  if (points_remaining == null) return null;
  const dossiers = dossiers_estimes ?? Math.floor(points_remaining / 10);

  return (
    <div className="px-3 pt-1">
      <p
        className="flex items-center gap-1.5 text-caption text-textSecondary"
        title={`Pack JobScout : ${points_remaining} points restants`}
      >
        <Sparkles className="h-3 w-3 shrink-0" />
        {`≈ ${dossiers} dossiers`}
      </p>
    </div>
  );
}
