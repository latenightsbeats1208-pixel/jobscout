import "server-only";
import { getEnabledScrapers } from "@/lib/scrapers/registry";
import { DEFAULT_SOURCE_IDS } from "@/lib/sources-meta";
import { upsertOffreFromSource, setOffreScore } from "@/lib/db/offres";
import { scoreOffresLocal } from "@/lib/scoring/local";
import { getProfile } from "@/lib/db/queries";
import { getDb } from "@/lib/db";
import type { ProgressEvent } from "@/lib/scrapers/base";

export type OrchestratorEvent =
  | ProgressEvent
  | { kind: "scored"; offre_id: number; score: number }
  | { kind: "error"; source: string; message: string }
  | { kind: "global-done"; total_inserted: number };

// Local scorer is fast — no need to batch heavily, but we keep batching for predictable yields.
const SCORE_BATCH = 20;

export async function* runScan(
  onLog: (line: string) => void,
  opts: { onlySource?: string } = {}
): AsyncGenerator<OrchestratorEvent> {
  const profile = getProfile();
  if (!profile) throw new Error("Aucun profil — terminez d'abord l'onboarding.");

  // Repli : les sources qui ne demandent aucun téléchargement supplémentaire
  // (LinkedIn exige le moteur Chromium et reste donc opt-in).
  const allEnabled = profile.sources_enabled?.length
    ? profile.sources_enabled
    : DEFAULT_SOURCE_IDS;
  // If onlySource is set, restrict to it (whether or not it's in the user's enabled list).
  const enabled = opts.onlySource
    ? [opts.onlySource]
    : allEnabled;
  const scrapers = getEnabledScrapers(enabled);
  if (scrapers.length === 0) {
    throw new Error(`Aucun scraper actif pour la source "${opts.onlySource ?? "(défaut)"}".`);
  }

  const db = getDb();
  const runRes = db.prepare("INSERT INTO scan_runs (status) VALUES ('running')").run();
  const runId = Number(runRes.lastInsertRowid);
  const log: string[] = [];
  const flush = () =>
    db.prepare("UPDATE scan_runs SET log = ? WHERE id = ?").run(JSON.stringify(log), runId);

  let totalInserted = 0;

  for (const scraper of scrapers) {
    let seen = 0;
    let okCount = 0;
    let failCount = 0;
    const buffer: { id: number; offre: any }[] = [];
    const pendingScoring: OrchestratorEvent[] = [];

    try {
      const criteria = { sectors: profile.sectors, countries: profile.target_countries };
      const progressQueue: ProgressEvent[] = [];
      const onEvent = (e: ProgressEvent) => progressQueue.push(e);

      for await (const offre of scraper.scrape(criteria, onEvent)) {
        // Drain progress events emitted before this offre
        while (progressQueue.length) {
          const ev = progressQueue.shift()!;
          if (ev.kind === "list") seen = ev.total;
          if (ev.kind === "offre" && ev.status === "failed") failCount++;
          yield ev;
        }

        const id = upsertOffreFromSource(scraper.name, offre);
        if (offre.description_status === "ok") {
          totalInserted++;
          okCount++;
          buffer.push({ id, offre });
          if (buffer.length >= SCORE_BATCH) {
            await scoreBatch(buffer, profile, pendingScoring);
            while (pendingScoring.length) yield pendingScoring.shift()!;
          }
        }
      }

      // Drain remaining progress (done event)
      while (progressQueue.length) {
        const ev = progressQueue.shift()!;
        if (ev.kind === "offre" && ev.status === "failed") failCount++;
        yield ev;
      }

      if (buffer.length) {
        await scoreBatch(buffer, profile, pendingScoring);
        while (pendingScoring.length) yield pendingScoring.shift()!;
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      onLog(`[${scraper.name}] erreur fatale: ${msg}`);
      // Persisté dans scan_runs.log : sans cela, une source qui plante dès le
      // départ (moteur absent, API HS) laissait « 0 vues, 0 échecs » sans cause.
      log.push(`[${scraper.name}] erreur fatale: ${msg}`);
      yield { kind: "error", source: scraper.name, message: msg };
    }
    const summary = `[${scraper.name}] ${seen || okCount + failCount} vues, ${okCount} insérées, ${failCount} échecs`;
    log.push(summary);
    onLog(summary);
    flush();
  }

  db.prepare("UPDATE scan_runs SET status = 'done', finished_at = datetime('now') WHERE id = ?").run(runId);
  yield { kind: "global-done", total_inserted: totalInserted };
}

async function scoreBatch(
  buffer: { id: number; offre: any }[],
  profile: any,
  out: OrchestratorEvent[]
) {
  const offresForScoring = buffer.map((b) => ({
    title: b.offre.title,
    company: b.offre.company,
    country: b.offre.country,
    description_text: b.offre.description_text,
    contract_type: b.offre.contract_type ?? null,
  }));
  try {
    // Local deterministic scoring — no API call, instantaneous, no token cost.
    const results = scoreOffresLocal(profile, offresForScoring);
    results.forEach((r, i) => {
      const id = buffer[i].id;
      if (id) {
        setOffreScore(id, r);
        out.push({ kind: "scored", offre_id: id, score: r.score });
      }
    });
  } catch (e) {
    out.push({ kind: "error", source: "scoring", message: e instanceof Error ? e.message : String(e) });
  }
  buffer.length = 0;
}
