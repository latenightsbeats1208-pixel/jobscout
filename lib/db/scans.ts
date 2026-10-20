import "server-only";
import { getDb, parseJson } from "./index";
import type { ScanFailure, ScanStatus } from "@/lib/scan/orchestrator";

export type LastScan = { finished_at: string; status: ScanStatus; failures: ScanFailure[] };

/** Dernier scan arrivé au bout, avec ses sources en échec. */
export function lastFinishedScan(): LastScan | null {
  const row = getDb()
    .prepare("SELECT finished_at, status, summary FROM scan_runs WHERE finished_at IS NOT NULL ORDER BY id DESC LIMIT 1")
    .get() as { finished_at: string; status: string; summary: string | null } | undefined;
  if (!row) return null;
  const status: ScanStatus = row.status === "partial" || row.status === "failed" ? row.status : "done";
  return { finished_at: row.finished_at, status, failures: parseJson<{ failures?: ScanFailure[] }>(row.summary, {}).failures ?? [] };
}

export type CurrentSearch = {
  /** Début du premier scan de la recherche, à l'horloge de scraped_at. */
  since: string;
  /** Ligne « Recherche : « … » — zone : … » de ces scans. */
  label: string;
};

/**
 * La recherche en cours : les derniers scans qui annoncent la même ligne
 * « Recherche : … — zone : … ». Une offre revue depuis le premier d'entre eux
 * (scraped_at ≥ since) a été trouvée par cette recherche ; les autres viennent
 * d'une recherche précédente, notées pour le profil actuel sans avoir été
 * cherchées pour lui (1 392 offres commerciales sous un profil Acheteur, le
 * 19 octobre 2026). null tant qu'aucun scan n'annonce sa recherche.
 */
export function currentSearch(): CurrentSearch | null {
  const rows = getDb().prepare("SELECT started_at, log FROM scan_runs ORDER BY id DESC LIMIT 100").all() as { started_at: string; log: string }[];
  let found: CurrentSearch | null = null;
  for (const row of rows) {
    const first = parseJson<string[]>(row.log, [])[0];
    // Scan qui démarre : son journal n'est pas encore écrit.
    if (first === undefined && !found) continue;
    if (!first?.startsWith("Recherche : ") || (found && first !== found.label)) break;
    found = { since: row.started_at, label: first };
  }
  return found;
}
