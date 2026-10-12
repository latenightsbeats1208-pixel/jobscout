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
