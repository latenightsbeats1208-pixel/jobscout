import "server-only";
import { getDb, getSetting, setSetting } from "./index";
import {
  ensureHtmlEntitiesRepaired,
  HTML_ENTITIES_REPAIR_KEY,
  olderCodeScanRunning,
  registerCurrentScanRun,
  rescoreRepaired,
  RETRY_MS,
} from "./repair-entities";
import { repairEscapedMarkupDescription } from "@/lib/offres/clean-text";
import type { EscapedMarkupRule } from "@/lib/offres/escaped-markup";

/**
 * Réparation unique du balisage affiché en clair dans les offres déjà en base :
 * « <p><img …> » dans le texte d'offres Talent, « &lt;div&gt; » dans le profil d'offres
 * WTTJ, « <li d » à la fin d'offres APEC, « </p> » dans des offres LinkedIn.
 *
 * Même règle que le filet d'écriture (repairEscapedMarkupDescription, lib/offres/clean-text.ts),
 * sélection par contenu : une offre n'est retenue que si son HTML contient un « < » échappé
 * ET que la règle y change quelque chose ; seuls les champs qui changent sont réécrits
 * (description_html, et description_text re-dérivé du HTML réparé selon la source).
 *
 * Passe APRÈS la réparation des entités (migration:html-entities-v1) et seulement une fois
 * sa marque posée : elle réécrit un texte déjà décodé, qu'un décodage passé après
 * décoderait une seconde fois. Marquée dans settings (ne repasse jamais), faite en une
 * transaction, score local recalculé pour les seules offres dont le texte a changé.
 *
 * Déclenchée aux mêmes endroits que la réparation des entités (ensureOffresRepaired), sans
 * redémarrage. Elle attend la fin d'un scan lancé dans ce processus par du code d'avant ce
 * correctif (rechargement à chaud pendant un scan) : ses écritures passent sans ce filet, et
 * la marque interdirait ensuite de les réparer. Un scan du code actuel s'enregistre pour les
 * deux réparations (registerScanForRepairs) ; un scan enregistré pour la seule réparation
 * des entités (registerCurrentScanRun) fait attendre celle-ci.
 */

export const ESCAPED_MARKUP_REPAIR_KEY = "migration:escaped-markup-v1";

export type EscapedMarkupRepair = {
  /** Date de la réparation (ISO). */
  at: string;
  /** Offres réécrites, par id croissant. */
  ids: number[];
  /** Nombre d'offres réécrites par champ. */
  fields: { description_html?: number; description_text?: number };
  /** Nombre d'offres par règle appliquée. */
  rules: Partial<Record<EscapedMarkupRule, number>>;
  /** Offres au HTML réparé dont le texte ne dérivait pas du HTML : texte gardé tel quel. */
  textKept: number[];
  /** Offres dont le score a été recalculé (texte changé ; 0 sans profil). */
  rescored: number;
};

type Row = { id: number; source: string; description_html: string; description_text: string };

/**
 * Répare les offres en base, sauf si la marque existe déjà ou si la réparation des entités
 * n'a pas encore eu lieu (renvoie alors null). `force` ignore la marque (tests, contrôle
 * d'idempotence) : à ne pas utiliser ailleurs.
 */
export function repairEscapedMarkup(opts: { force?: boolean } = {}): EscapedMarkupRepair | null {
  const db = getDb();
  if (getSetting(HTML_ENTITIES_REPAIR_KEY) == null) return null;
  if (!opts.force && getSetting(ESCAPED_MARKUP_REPAIR_KEY) != null) return null;
  // IMMEDIATE : verrou d'écriture pris tout de suite, puis marques relues dans la
  // transaction (un autre processus a pu réparer entre-temps).
  db.exec("BEGIN IMMEDIATE");
  try {
    if (getSetting(HTML_ENTITIES_REPAIR_KEY) == null || (!opts.force && getSetting(ESCAPED_MARKUP_REPAIR_KEY) != null)) {
      db.exec("COMMIT");
      return null;
    }
    // Préfiltre SQL (sur-ensemble, LIKE ignore la casse) : un « < » échappé, &lt; ou
    // référence numérique ; la règle tranche ensuite.
    const rows = db.prepare(`
      SELECT id, source, description_html, description_text
      FROM offres
      WHERE description_html LIKE '%&lt;%' OR description_html LIKE '%&#%60;%' OR description_html LIKE '%&#x%3c;%'
      ORDER BY id
    `).all() as Row[];

    const ids: number[] = [];
    const textIds: number[] = [];
    const fields: EscapedMarkupRepair["fields"] = {};
    const rules: EscapedMarkupRepair["rules"] = {};
    const textKept: number[] = [];
    for (const row of rows) {
      const next = repairEscapedMarkupDescription(row.source, row.description_html, row.description_text);
      const changed = (["description_html", "description_text"] as const).filter((f) => next[f] !== row[f]);
      if (!changed.length) continue;
      // Colonnes prises dans la liste fixe ci-dessus, jamais dans les données.
      db.prepare(`UPDATE offres SET ${changed.map((f) => `${f} = ?`).join(", ")} WHERE id = ?`)
        .run(...changed.map((f) => next[f]), row.id);
      ids.push(row.id);
      if (changed.includes("description_text")) textIds.push(row.id);
      for (const f of changed) fields[f] = (fields[f] ?? 0) + 1;
      for (const r of new Set(next.rules)) rules[r] = (rules[r] ?? 0) + 1;
      if (next.textKept) textKept.push(row.id);
    }

    const rescored = rescoreRepaired(textIds, "Balisage des offres réparé");
    const result: EscapedMarkupRepair = { at: new Date().toISOString(), ids, fields, rules, textKept, rescored };
    // Un passage forcé ne remplace pas la marque d'origine (ids réellement réparés).
    if (!opts.force || getSetting(ESCAPED_MARKUP_REPAIR_KEY) == null) {
      setSetting(ESCAPED_MARKUP_REPAIR_KEY, JSON.stringify(result));
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

/** Marque de la réparation (ids réparés, comptes par champ et par règle), ou null si elle n'a pas eu lieu. */
export function readEscapedMarkupRepair(): EscapedMarkupRepair | null {
  const raw = getSetting(ESCAPED_MARKUP_REPAIR_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as EscapedMarkupRepair;
  } catch {
    return null;
  }
}

// État partagé entre les copies du module (bundles dupliqués, rechargement à chaud),
// distinct de celui de la réparation des entités : un scan enregistré pour la seule
// réparation des entités n'y figure pas, il fait donc attendre cette réparation-ci.
type RepairState = {
  done: boolean;
  retryAt: number;
  /** Scans (scan_runs.id) lancés par ce code, donc écrits à travers le filet du balisage. */
  ownScanRuns?: number[];
  /** Scan de l'ancien code qui a fait attendre la réparation (une ligne de log par scan). */
  waitedFor?: number;
};
const G = globalThis as typeof globalThis & { __jobscoutEscapedMarkupRepairV1?: RepairState };
const repairState = (): RepairState => (G.__jobscoutEscapedMarkupRepairV1 ??= { done: false, retryAt: 0 });

/** À appeler par le scan (lib/scan/orchestrator.ts) dès la création de sa ligne scan_runs : vaut pour les deux réparations. */
export function registerScanForRepairs(runId: number): void {
  registerCurrentScanRun(runId);
  (repairState().ownScanRuns ??= []).push(runId);
}

/**
 * Renvoie le résultat si la réparation vient d'avoir lieu dans cet appel, null sinon. Ne
 * lève jamais : en cas d'échec (base verrouillée par un autre processus…) ou pendant un
 * scan de l'ancien code, nouvel essai au plus tôt une minute après. Tant que la marque des
 * entités manque (réparation des entités reportée), elle ne fait rien et reste à faire.
 */
export function ensureEscapedMarkupRepaired(): EscapedMarkupRepair | null {
  const state = repairState();
  if (state.done || Date.now() < state.retryAt) return null;
  try {
    if (getSetting(ESCAPED_MARKUP_REPAIR_KEY) != null) {
      state.done = true;
      return null;
    }
    if (getSetting(HTML_ENTITIES_REPAIR_KEY) == null) return null;
    const waitFor = olderCodeScanRunning(state.ownScanRuns);
    if (waitFor != null) {
      state.retryAt = Date.now() + RETRY_MS;
      if (state.waitedFor !== waitFor) {
        state.waitedFor = waitFor;
        console.info(`[JobScout] Réparation du balisage des offres reportée à la fin du scan ${waitFor} (lancé avant la mise à jour).`);
      }
      return null;
    }
    const result = repairEscapedMarkup();
    if (result != null || getSetting(ESCAPED_MARKUP_REPAIR_KEY) != null) state.done = true;
    return result;
  } catch (e) {
    state.retryAt = Date.now() + RETRY_MS;
    console.error(
      "[JobScout] Réparation du balisage des offres reportée :",
      e instanceof Error ? e.message : e
    );
    return null;
  }
}

/**
 * À appeler avant de lire ou d'écrire des offres : réparation des entités puis du
 * balisage, chacune dans sa transaction avec sa marque (un échec de la seconde
 * n'annule pas la première). Renvoie le nombre d'offres réécrites par cet appel (0 le plus
 * souvent), pour vider le cache des offres. Ne lève jamais.
 */
export function ensureOffresRepaired(): number {
  const entities = ensureHtmlEntitiesRepaired();
  const markup = ensureEscapedMarkupRepaired();
  return (entities?.ids.length ?? 0) + (markup?.ids.length ?? 0);
}
