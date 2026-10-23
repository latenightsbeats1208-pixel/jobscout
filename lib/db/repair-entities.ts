import "server-only";
import { asJson, getDb, getSetting, setSetting } from "./index";
import { getProfile } from "./queries";
import { fixMojibake } from "@/lib/offres/clean-text";
import { scoreOffreLocal } from "@/lib/scoring/local";
import { decodeHtmlEntities, repairDoubleEscapedHtml } from "@/lib/text/entities";

/**
 * Réparation unique des entités HTML restées en clair dans les offres déjà
 * en base : « Chargé d&apos;études », « exp&eacute;rience », « Bac&#43;5 »,
 * « ind&amp;eacute;pendante » dans le HTML.
 *
 * Mêmes règles que le filet d'écriture (lib/offres/clean-text.ts), restreintes aux
 * champs qui contiennent réellement une entité : un champ que le décodage ne change
 * pas n'est pas réécrit (ni repassé par fixMojibake). Le décodage n'étant pas
 * idempotent (« &amp;lt; » → « &lt; » → « < »), la réparation est marquée dans
 * settings et ne repasse jamais ; elle est faite en une transaction.
 *
 * Score : recalculé sur le texte réparé pour les seules offres réparées (score local
 * et déterministe, même calcul que « Re-scorer ») ; la catégorie de contrat, recalculée
 * à chaque reconstruction du cache, suivait déjà le texte réparé et le score non (il
 * avait été calculé sur le texte encore encodé).
 * Sans profil, le score reste tel quel : « Re-scorer » reste le recours. is_vie n'est
 * pas recalculé (le décodage des entités ne change pas sa détection).
 *
 * Aucun redémarrage nécessaire : elle est déclenchée par la première lecture ou la
 * première écriture des offres (lib/db/offres.ts) ou la première page de
 * l'application ((app)/layout.tsx), y compris sur un serveur de développement déjà
 * lancé. Elle attend en revanche la fin d'un scan lancé dans ce processus par le code
 * d'avant le correctif (rechargement à chaud pendant un scan) : ses écritures gardent
 * les entités, et la marque interdirait ensuite de les réparer. Mise à jour conseillée
 * malgré tout hors scan : JobScout arrêté, puis relancé.
 */

export const HTML_ENTITIES_REPAIR_KEY = "migration:html-entities-v1";

const SHORT_FIELDS = ["title", "company", "country", "location", "contract_type", "salary"] as const;
type Field = (typeof SHORT_FIELDS)[number] | "description_text" | "description_html";
type Row = { id: number } & Record<Field, string | null>;

export type HtmlEntitiesRepair = {
  /** Date de la réparation (ISO). */
  at: string;
  /** Offres réécrites, par id croissant. */
  ids: number[];
  /** Nombre d'offres réécrites par champ. */
  fields: Partial<Record<Field, number>>;
  /** Offres réparées dont le score a été recalculé (0 sans profil). */
  rescored: number;
};

const decodeText = (s: string) => decodeHtmlEntities(s);
const decodeDescription = (s: string) => decodeHtmlEntities(s, { nbspToSpace: true });

/** Valeur réparée d'un champ texte : seulement si une entité a été décodée. */
function repairText(value: string | null, decode: (s: string) => string): string | null {
  if (value == null) return value;
  const decoded = decode(value);
  return decoded === value ? value : fixMojibake(decoded);
}

/**
 * Score local recalculé sur le texte réparé, au format de setOffreScore (lib/db/offres.ts,
 * non importé : offres.ts importe ce module). Un échec du calcul n'empêche pas la
 * réparation des textes : le score reste alors tel quel. Partagé avec la réparation du
 * balisage (lib/db/repair-markup.ts) ; `what` nomme la réparation dans le message d'erreur.
 */
export function rescoreRepaired(ids: number[], what = "Entités HTML réparées"): number {
  if (!ids.length) return 0;
  const db = getDb();
  let scores: { id: number; score: number; breakdown: string }[];
  try {
    const profile = getProfile();
    if (!profile) return 0;
    const read = db.prepare("SELECT title, company, country, contract_type, description_text FROM offres WHERE id = ?");
    scores = ids.map((id) => {
      const o = read.get(id) as { title: string; company: string; country: string | null; contract_type: string | null; description_text: string };
      const r = scoreOffreLocal(profile, {
        title: o.title,
        company: o.company,
        country: o.country,
        description_text: o.description_text,
        contract_type: o.contract_type,
      });
      return { id, score: r.score, breakdown: asJson({ ...r.breakdown, reason: r.reason }) };
    });
  } catch (e) {
    console.error(
      `[JobScout] ${what}, score non recalculé (utiliser « Re-scorer ») :`,
      e instanceof Error ? e.message : e
    );
    return 0;
  }
  const write = db.prepare("UPDATE offres SET score = ?, score_breakdown = ? WHERE id = ?");
  for (const s of scores) write.run(s.score, s.breakdown, s.id);
  return scores.length;
}

/**
 * Répare les offres en base, sauf si la marque existe déjà (renvoie alors null).
 * `force` ignore la marque (tests, contrôle d'idempotence) : à ne pas utiliser ailleurs.
 */
export function repairHtmlEntities(opts: { force?: boolean } = {}): HtmlEntitiesRepair | null {
  const db = getDb();
  if (!opts.force && getSetting(HTML_ENTITIES_REPAIR_KEY) != null) return null;
  // IMMEDIATE : verrou d'écriture pris tout de suite, puis marque relue dans la
  // transaction (un autre processus a pu réparer entre-temps).
  db.exec("BEGIN IMMEDIATE");
  try {
    if (!opts.force && getSetting(HTML_ENTITIES_REPAIR_KEY) != null) {
      db.exec("COMMIT");
      return null;
    }
    // Préfiltre SQL : une entité exige « & » puis « ; » ; dans le HTML, seul le
    // double échappement (« &amp;…; ») est réparé.
    const rows = db.prepare(`
      SELECT id, title, company, country, location, contract_type, salary, description_text, description_html
      FROM offres
      WHERE title LIKE '%&%;%' OR company LIKE '%&%;%' OR country LIKE '%&%;%' OR location LIKE '%&%;%'
        OR contract_type LIKE '%&%;%' OR salary LIKE '%&%;%' OR description_text LIKE '%&%;%'
        OR description_html LIKE '%&amp;%;%'
      ORDER BY id
    `).all() as Row[];

    const ids: number[] = [];
    const fields: Partial<Record<Field, number>> = {};
    for (const row of rows) {
      const next: Partial<Record<Field, string | null>> = {};
      for (const f of SHORT_FIELDS) next[f] = repairText(row[f], decodeText);
      next.description_text = repairText(row.description_text, decodeDescription);
      next.description_html = row.description_html == null ? null : repairDoubleEscapedHtml(row.description_html);
      const changed = (Object.keys(next) as Field[]).filter((f) => next[f] !== row[f]);
      if (!changed.length) continue;
      // Colonnes prises dans la liste fixe ci-dessus, jamais dans les données.
      db.prepare(`UPDATE offres SET ${changed.map((f) => `${f} = ?`).join(", ")} WHERE id = ?`)
        .run(...changed.map((f) => next[f] ?? null), row.id);
      ids.push(row.id);
      for (const f of changed) fields[f] = (fields[f] ?? 0) + 1;
    }

    const rescored = rescoreRepaired(ids);
    const result: HtmlEntitiesRepair = { at: new Date().toISOString(), ids, fields, rescored };
    // Un passage forcé ne remplace pas la marque d'origine (ids réellement réparés).
    if (!opts.force || getSetting(HTML_ENTITIES_REPAIR_KEY) == null) {
      setSetting(HTML_ENTITIES_REPAIR_KEY, JSON.stringify(result));
    }
    db.exec("COMMIT");
    return result;
  } catch (e) {
    try {
      db.exec("ROLLBACK");
    } catch {}
    throw e;
  }
}

/** Marque de la réparation (ids réparés, comptes par champ), ou null si elle n'a pas eu lieu. */
export function readHtmlEntitiesRepair(): HtmlEntitiesRepair | null {
  const raw = getSetting(HTML_ENTITIES_REPAIR_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as HtmlEntitiesRepair;
  } catch {
    return null;
  }
}

// État partagé entre les copies du module (bundles dupliqués, rechargement à chaud) :
// une fois la marque constatée, chaque lecture ne coûte qu'un test de propriété.
type RepairState = {
  done: boolean;
  retryAt: number;
  /** Scans (scan_runs.id) lancés par ce code, donc écrits à travers le filet. */
  ownScanRuns?: number[];
  /** Scan de l'ancien code qui a fait attendre la réparation (une ligne de log par scan). */
  waitedFor?: number;
};
const G = globalThis as typeof globalThis & { __jobscoutHtmlEntitiesRepairV1?: RepairState };
export const RETRY_MS = 60_000;
// Au-delà, un scan resté « running » est tenu pour figé (un scan complet dure nettement
// moins longtemps) : il ne fait plus attendre la réparation.
const SCAN_STALE_MS = 30 * 60_000;

const repairState = (): RepairState => (G.__jobscoutHtmlEntitiesRepairV1 ??= { done: false, retryAt: 0 });

/** Scan du code actuel, dès la création de sa ligne scan_runs (appelé par registerScanForRepairs, lib/db/repair-markup.ts). */
export function registerCurrentScanRun(runId: number): void {
  (repairState().ownScanRuns ??= []).push(runId);
}

const sqlUtc = (ms: number) => new Date(ms).toISOString().slice(0, 19).replace("T", " ");

/**
 * Scan en cours lancé dans CE processus par le code d'avant le correctif (rechargement
 * à chaud pendant un scan) : « running », démarré depuis le lancement du processus et il
 * y a moins de SCAN_STALE_MS, et absent de `own` (scans enregistrés par le code qui
 * répare). Une ligne « running » plus ancienne que le processus vient d'un scan mort
 * (serveur arrêté). Partagé avec la réparation du balisage (lib/db/repair-markup.ts).
 */
export function olderCodeScanRunning(own: readonly number[] = []): number | null {
  const now = Date.now();
  const since = Math.max(now - process.uptime() * 1000, now - SCAN_STALE_MS);
  const rows = getDb()
    .prepare("SELECT id FROM scan_runs WHERE status = 'running' AND datetime(started_at) >= datetime(?) ORDER BY id")
    .all(sqlUtc(since)) as { id: number }[];
  return rows.find((r) => !own.includes(Number(r.id)))?.id ?? null;
}

/**
 * À appeler avant de lire ou d'écrire des offres, via ensureOffresRepaired (lib/db/repair-markup.ts,
 * qui enchaîne la réparation du balisage). Renvoie le résultat si la réparation
 * vient d'avoir lieu dans cet appel, null sinon. Ne lève jamais : en cas d'échec (base
 * verrouillée par un autre processus…) ou pendant un scan de l'ancien code, nouvel
 * essai au plus tôt une minute après.
 */
export function ensureHtmlEntitiesRepaired(): HtmlEntitiesRepair | null {
  const state = repairState();
  if (state.done || Date.now() < state.retryAt) return null;
  try {
    if (getSetting(HTML_ENTITIES_REPAIR_KEY) != null) {
      state.done = true;
      return null;
    }
    const waitFor = olderCodeScanRunning(state.ownScanRuns);
    if (waitFor != null) {
      state.retryAt = Date.now() + RETRY_MS;
      if (state.waitedFor !== waitFor) {
        state.waitedFor = waitFor;
        console.info(`[JobScout] Réparation des entités HTML des offres reportée à la fin du scan ${waitFor} (lancé avant la mise à jour).`);
      }
      return null;
    }
    const result = repairHtmlEntities();
    state.done = true;
    return result;
  } catch (e) {
    state.retryAt = Date.now() + RETRY_MS;
    console.error(
      "[JobScout] Réparation des entités HTML des offres reportée :",
      e instanceof Error ? e.message : e
    );
    return null;
  }
}
