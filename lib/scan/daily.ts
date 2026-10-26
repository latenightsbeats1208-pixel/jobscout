import "server-only";
import { runScan } from "@/lib/scan/orchestrator";
import { getProfile } from "@/lib/db/queries";
import { getDb } from "@/lib/db";

/**
 * Scan quotidien automatique, pour un JobScout qui tourne en permanence
 * (serveur auto-hébergé). Activé par JOBSCOUT_DAILY_SCAN=HH:MM, heure locale
 * du conteneur (variable TZ). Les offres trouvées sont scorées comme lors d'un
 * scan lancé à la main : il n'y a plus qu'à ouvrir la page Offres le matin.
 */

const CHECK_EVERY_MS = 60_000;
/** Un scan manuel « running » plus récent que ce délai est tenu pour en cours. */
const MANUAL_SCAN_WINDOW_MIN = 45;

type DailyState = { started: boolean; running: boolean; lastRunDay: string | null };

// État partagé par toutes les instances du module (Next peut le charger plusieurs fois).
const g = globalThis as typeof globalThis & { __jobscoutDaily?: DailyState };
const state: DailyState = (g.__jobscoutDaily ??= { started: false, running: false, lastRunDay: null });

export function parseDailyTime(raw: string | undefined): { h: number; m: number } | null {
  const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(raw?.trim() ?? "");
  return match ? { h: Number(match[1]), m: Number(match[2]) } : null;
}

function localDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function manualScanInProgress(): boolean {
  const row = getDb()
    .prepare(
      `SELECT 1 FROM scan_runs WHERE status = 'running' AND datetime(started_at) >= datetime('now', ?) LIMIT 1`
    )
    .get(`-${MANUAL_SCAN_WINDOW_MIN} minutes`);
  return Boolean(row);
}

export async function runDailyScan(): Promise<void> {
  if (state.running) return;
  if (!getProfile()) {
    console.log("[daily-scan] aucun profil : terminez l'onboarding, scan ignoré.");
    return;
  }
  if (manualScanInProgress()) {
    console.log("[daily-scan] un scan est déjà en cours, scan quotidien ignoré.");
    return;
  }
  state.running = true;
  const t0 = Date.now();
  console.log("[daily-scan] démarrage");
  try {
    for await (const ev of runScan((line) => console.log(`[daily-scan] ${line}`))) {
      if (ev.kind === "error") console.log(`[daily-scan] ${ev.source} : ${ev.message}`);
      if (ev.kind === "global-done")
        console.log(`[daily-scan] terminé : ${ev.total_inserted} nouvelle(s) offre(s) en ${Math.round((Date.now() - t0) / 1000)} s`);
    }
  } catch (e) {
    console.log(`[daily-scan] échec : ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    state.running = false;
  }
}

export function startDailyScan(): void {
  const at = parseDailyTime(process.env.JOBSCOUT_DAILY_SCAN);
  if (!at || state.started) return;
  state.started = true;
  // Démarrage après l'heure prévue : le scan du jour n'est pas rattrapé
  // (un redémarrage du conteneur à 15 h ne relance pas un scan complet).
  const now = new Date();
  if (now.getHours() * 60 + now.getMinutes() > at.h * 60 + at.m) state.lastRunDay = localDay(now);
  const hhmm = `${String(at.h).padStart(2, "0")}:${String(at.m).padStart(2, "0")}`;
  console.log(`[daily-scan] programmé chaque jour à ${hhmm} (fuseau ${Intl.DateTimeFormat().resolvedOptions().timeZone})`);
  const timer = setInterval(() => {
    const d = new Date();
    const day = localDay(d);
    if (state.lastRunDay === day) return;
    if (d.getHours() * 60 + d.getMinutes() < at.h * 60 + at.m) return;
    state.lastRunDay = day;
    void runDailyScan();
  }, CHECK_EVERY_MS);
  timer.unref?.();
}
