"use client";
import { useEffect, useState } from "react";
import { formatRelativeDate } from "@/lib/utils";

/**
 * Date relative (« il y a 15 min »), calculée dans le navigateur seulement.
 * Calculée aussi au rendu serveur, la minute pouvait changer entre les deux :
 * React signalait une erreur d'hydratation sur la fiche d'une offre (« 1 Issue »
 * en développement), qui masquait les vraies erreurs (audit du 19 octobre 2026).
 */
export function RelativeTime({ iso, prefix = "" }: { iso: string; prefix?: string }) {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => setText(formatRelativeDate(iso)), [iso]);
  return <time dateTime={iso}>{text === null ? null : `${prefix}${text}`}</time>;
}
