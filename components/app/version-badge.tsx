"use client";
import { useEffect, useState } from "react";
import { ArrowUpCircle } from "lucide-react";

type UpdateStatus = {
  current: string;
  variant?: "prod" | "test";
  latest: string | null;
  updateAvailable: boolean;
  downloadUrl: string | null;
  sha256: string | null;
};

/**
 * Pied de barre latérale : version courante en sobre, et — seulement si le
 * serveur a réussi à joindre l'endpoint de version — une pastille discrète
 * proposant la mise à jour. `productName` vaut « JobScout Test » dans
 * l'installeur de test (lib/update/check.ts › productName()).
 */
export function VersionBadge({
  version,
  productName = "JobScout",
}: {
  version: string;
  productName?: string;
}) {
  const [status, setStatus] = useState<UpdateStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/update", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: UpdateStatus | null) => {
        if (!cancelled && d) setStatus(d);
      })
      .catch(() => {
        /* hors-ligne : rien à signaler */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const displayed = status?.current ?? version;

  return (
    <div className="px-3 pt-3 space-y-2">
      <p className="text-caption text-textSecondary">{`${productName} v${displayed}`}</p>
      {/* Hôte hors allowlist (§6.7) => downloadUrl null : on annonce la version
          SANS lien, au lieu d'un lien mort vers « # ». */}
      {status?.updateAvailable &&
        (status.downloadUrl ? (
          <a
            href={status.downloadUrl}
            target="_blank"
            rel="noopener noreferrer"
            title={status.sha256 ? `SHA-256 de l'installeur : ${status.sha256}` : undefined}
            className="flex items-center gap-2 text-caption text-accent hover:underline"
          >
            <ArrowUpCircle className="h-3.5 w-3.5 shrink-0" />
            Version {status.latest} disponible
          </a>
        ) : (
          <p className="flex items-center gap-2 text-caption text-textSecondary">
            <ArrowUpCircle className="h-3.5 w-3.5 shrink-0" />
            Version {status.latest} disponible
          </p>
        ))}
    </div>
  );
}
