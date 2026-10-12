import "server-only";
import { getDb, transaction } from "@/lib/db";
import { CHECKABLE_SOURCES, checkLiveness, type Liveness, type LivenessRef } from "./liveness";

/** Une offre vérifiée il y a moins longtemps n'est pas revérifiée par le scan. */
const RECHECK_AFTER_HOURS = 24;

export type LivenessRun = { checked: number; closed: number; reopened: number; suspicious: string[] };

/** Enregistre le résultat : retirée (date de constat gardée), de nouveau en ligne, ou rien de sûr. */
export function applyLiveness(results: Map<number, Liveness>): { closed: number; reopened: number } {
  const db = getDb();
  const close = db.prepare(
    "UPDATE offres SET closed_at = COALESCE(closed_at, datetime('now')), checked_at = datetime('now') WHERE id = ?"
  );
  const open = db.prepare("UPDATE offres SET closed_at = NULL, checked_at = datetime('now') WHERE id = ?");
  const wasClosed = db.prepare("SELECT closed_at IS NOT NULL AS c FROM offres WHERE id = ?");
  let closed = 0;
  let reopened = 0;
  transaction(() => {
    for (const [id, state] of results) {
      if (state === "closed") {
        if (!(wasClosed.get(id) as { c: number } | undefined)?.c) closed++;
        close.run(id);
      } else if (state === "open") {
        if ((wasClosed.get(id) as { c: number } | undefined)?.c) reopened++;
        open.run(id);
      }
      // « unknown » : ni constat ni date de vérification, l'offre sera revue.
    }
  });
  return { closed, reopened };
}

/**
 * Fin de scan : les offres en ligne que ce scan n'a PAS revues (une source ne
 * renvoie qu'une partie de ses offres : ne plus la voir ne prouve rien), les
 * mieux notées d'abord, chacune au plus une fois par jour.
 */
export function livenessCandidates(opts: { notSeenSince: string; limit: number }): LivenessRef[] {
  const sources = [...CHECKABLE_SOURCES];
  return getDb()
    .prepare(
      `SELECT id, source, source_id, url FROM offres
       WHERE closed_at IS NULL
         AND scraped_at < ?
         AND source IN (${sources.map(() => "?").join(",")})
         AND (checked_at IS NULL OR checked_at < datetime('now', ?))
       ORDER BY score DESC, id DESC
       LIMIT ?`
    )
    .all(opts.notSeenSince, ...sources, `-${RECHECK_AFTER_HOURS} hours`, opts.limit) as LivenessRef[];
}

export async function checkStoredLiveness(opts: { notSeenSince: string; limit: number; delayMs?: number }): Promise<LivenessRun> {
  const refs = livenessCandidates(opts);
  if (!refs.length) return { checked: 0, closed: 0, reopened: 0, suspicious: [] };
  const { results, suspicious } = await checkLiveness(refs, { delayMs: opts.delayMs });
  const { closed, reopened } = applyLiveness(results);
  return { checked: refs.length, closed, reopened, suspicious };
}
