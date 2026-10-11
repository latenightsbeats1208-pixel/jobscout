import "server-only";
import { getEnabledScrapers } from "@/lib/scrapers/registry";
import { DEFAULT_SOURCE_IDS, sourceLabel, sourceUnavailable } from "@/lib/sources-meta";
import { upsertOffreFromSource, setOffreScore } from "@/lib/db/offres";
import { scoreOffresLocal } from "@/lib/scoring/local";
import { loadCorpus, rescoreAllOffres } from "@/lib/scoring/rescore";
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
  // (LinkedIn exige le moteur Chromium et reste donc opt-in). Un profil
  // enregistré sans source (profil 3.4.x, profil restauré) scanne ainsi
  // toujours quelque chose, scan quotidien compris — l'éditeur de profil
  // empêche par ailleurs d'enregistrer une liste vide.
  const allEnabled = profile.sources_enabled?.length
    ? profile.sources_enabled
    : DEFAULT_SOURCE_IDS;
  // If onlySource is set, restrict to it (whether or not it's in the user's enabled list).
  const requested = opts.onlySource ? [opts.onlySource] : allEnabled;
  // Une source suspendue (Civiweb, APEC) n'est jamais interrogée, même restée cochée
  // dans un ancien profil ou dans un profil enregistré que l'on restaure.
  const enabled = requested.filter((id) => !sourceUnavailable(id));
  for (const id of requested.filter(sourceUnavailable)) onLog(`${sourceLabel(id)} : source suspendue, ignorée.`);
  const scrapers = getEnabledScrapers(enabled);
  if (scrapers.length === 0) {
    throw new Error(
      opts.onlySource
        ? sourceUnavailable(opts.onlySource)
          ? `La source « ${sourceLabel(opts.onlySource)} » est suspendue.`
          : `Aucun scraper actif pour la source "${opts.onlySource}".`
        : "Aucune source active dans le profil : cochez-en au moins une dans Profil › Recherche."
    );
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

  // Les premiers lots ont été notés avec une rareté mesurée sur moins d'offres :
  // un recalcul final remet toutes les offres sur la même échelle.
  try {
    rescoreAllOffres(profile);
  } catch (e) {
    yield { kind: "error", source: "scoring", message: e instanceof Error ? e.message : String(e) };
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
    location: b.offre.location ?? null,
    description_text: b.offre.description_text,
    contract_type: b.offre.contract_type ?? null,
  }));
  try {
    // Note locale, sans appel réseau ; la rareté des mots se mesure sur toutes
    // les offres déjà en base, lot courant compris (il vient d'être enregistré).
    const results = scoreOffresLocal(profile, offresForScoring, loadCorpus());
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
