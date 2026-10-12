import "server-only";
import { BROWSER_HEADERS, sleep } from "./dom";
import { WTTJ_ALGOLIA } from "./wttj";

/**
 * Une offre est-elle toujours publiée par sa source ? Seul un signal net de la
 * source la déclare retirée : sans lui, « unknown », et l'offre reste affichée.
 * Signaux relevés en octobre 2026 :
 * - France Travail : le JSON de la description répond 204 (offre inconnue ou
 *   retirée) ; 200 tant qu'elle est en ligne ;
 * - HelloWork : 410 Gone pour une offre expirée, 404 pour un numéro inconnu ;
 * - Talent.com : 404 pour une offre retirée ou inconnue. Sinon, la page porte
 *   une date d'expiration (« system_date_expired ») qui ne vaut que si l'offre
 *   n'a pas été retrouvée depuis (« system_date_found », « …_re_found ») :
 *   sur 225 offres, 62 pages en 200 portaient une date d'expiration, souvent
 *   suivie d'une remise en ligne quelques heures plus tard ;
 * - Welcome to the Jungle : l'offre disparaît de l'index de recherche (lecture
 *   par identifiant, 50 à la fois). Les pages HTML sont derrière un défi
 *   anti-robot et ne sont pas interrogées.
 * LinkedIn n'est pas vérifié : ses pages ne s'ouvrent qu'avec le moteur, et le
 * site limite les visites.
 */

export type Liveness = "open" | "closed" | "unknown";
export type LivenessRef = { id: number; source: string; source_id: string; url: string };
export type LivenessReport = {
  results: Map<number, Liveness>;
  /** Sources dont TOUTES les offres vérifiées paraissaient retirées : résultat ignoré. */
  suspicious: string[];
};

const FT_DESCRIPTIF = "https://candidat.francetravail.fr/api-descriptifoffre/offre";
const TIMEOUT_MS = 12_000;
/** Pause entre deux requêtes vers une même source. */
const DELAY_MS = 700;
const WTTJ_BATCH = 50;
/**
 * À partir de ce nombre d'offres vérifiées, « toutes retirées » ressemble plus
 * à un changement du site (adresse, format) qu'à une vague de fermetures : le
 * résultat est ignoré plutôt que de masquer toute la source.
 */
const SUSPICIOUS_MIN = 5;

async function get(url: string, headers: Record<string, string> = BROWSER_HEADERS): Promise<Response | null> {
  try {
    return await fetch(url, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    return null;
  }
}

async function checkFranceTravail(ref: LivenessRef): Promise<Liveness> {
  const res = await get(`${FT_DESCRIPTIF}/${encodeURIComponent(ref.source_id)}`, { ...BROWSER_HEADERS, accept: "application/json" });
  if (!res) return "unknown";
  if (res.status === 204 || res.status === 404) return "closed";
  return res.status === 200 ? "open" : "unknown";
}

async function checkHellowork(ref: LivenessRef): Promise<Liveness> {
  const res = await get(ref.url);
  if (!res) return "unknown";
  if (res.status === 410 || res.status === 404) return "closed";
  return res.status === 200 ? "open" : "unknown";
}

/** Champ des données de la page, échappé dans une chaîne JavaScript : \"system_date_expired\":\"…\" */
function talentDate(html: string, field: string): number | null {
  const m = html.match(new RegExp(`${field}\\\\*"\\s*:\\s*\\\\*"([^"\\\\]*)`));
  if (!m) return null;
  const t = Date.parse(m[1]);
  return Number.isNaN(t) ? 0 : t;
}

/** Page d'une offre Talent.com (statut 200) : retirée si expirée et jamais retrouvée depuis. */
export function talentPageLiveness(html: string): Liveness {
  const expired = talentDate(html, "system_date_expired");
  if (expired === null) return "unknown"; // format de page inconnu
  if (!expired) return "open";
  const seenAgain = Math.max(talentDate(html, "system_date_found") ?? 0, talentDate(html, "system_date_re_found") ?? 0);
  return seenAgain > expired ? "open" : "closed";
}

async function checkTalent(ref: LivenessRef): Promise<Liveness> {
  const res = await get(ref.url);
  if (!res) return "unknown";
  if (res.status === 410 || res.status === 404) return "closed";
  if (res.status !== 200) return "unknown";
  return talentPageLiveness(await res.text().catch(() => ""));
}

async function checkWttjBatch(refs: LivenessRef[]): Promise<Map<number, Liveness>> {
  const out = new Map<number, Liveness>();
  try {
    const res = await fetch(WTTJ_ALGOLIA.objectsUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-algolia-api-key": WTTJ_ALGOLIA.apiKey,
        "x-algolia-application-id": WTTJ_ALGOLIA.appId,
        referer: `${WTTJ_ALGOLIA.site}/`,
        origin: WTTJ_ALGOLIA.site,
      },
      body: JSON.stringify({
        requests: refs.map((r) => ({ indexName: WTTJ_ALGOLIA.index, objectID: r.source_id, attributesToRetrieve: ["objectID"] })),
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as { results?: ({ objectID?: string } | null)[] };
    if (!Array.isArray(data.results) || data.results.length !== refs.length) throw new Error("réponse inattendue");
    // Un résultat null : l'identifiant n'est plus dans l'index des offres publiées.
    refs.forEach((r, i) => out.set(r.id, data.results![i] ? "open" : "closed"));
  } catch {
    for (const r of refs) out.set(r.id, "unknown");
  }
  return out;
}

const ONE_BY_ONE: Record<string, (ref: LivenessRef) => Promise<Liveness>> = {
  francetravail: checkFranceTravail,
  hellowork: checkHellowork,
  talent: checkTalent,
};

/** Sources dont on sait reconnaître une offre retirée. */
export const CHECKABLE_SOURCES = new Set([...Object.keys(ONE_BY_ONE), "wttj"]);

async function checkSource(source: string, refs: LivenessRef[], delayMs: number): Promise<Map<number, Liveness>> {
  if (source === "wttj") {
    const out = new Map<number, Liveness>();
    for (let i = 0; i < refs.length; i += WTTJ_BATCH) {
      if (i) await sleep(delayMs);
      for (const [id, state] of await checkWttjBatch(refs.slice(i, i + WTTJ_BATCH))) out.set(id, state);
    }
    return out;
  }
  const check = ONE_BY_ONE[source];
  const out = new Map<number, Liveness>();
  for (const [i, ref] of refs.entries()) {
    if (i) await sleep(delayMs);
    out.set(ref.id, check ? await check(ref) : "unknown");
  }
  return out;
}

/** Vérifie des offres, source par source (les sources en parallèle, une requête à la fois par source). */
export async function checkLiveness(refs: LivenessRef[], opts: { delayMs?: number } = {}): Promise<LivenessReport> {
  const bySource = new Map<string, LivenessRef[]>();
  for (const r of refs) {
    if (!CHECKABLE_SOURCES.has(r.source)) continue;
    (bySource.get(r.source) ?? bySource.set(r.source, []).get(r.source)!).push(r);
  }
  const results = new Map<number, Liveness>(refs.map((r) => [r.id, "unknown"]));
  const suspicious: string[] = [];
  await Promise.all(
    [...bySource].map(async ([source, list]) => {
      const states = await checkSource(source, list, opts.delayMs ?? DELAY_MS);
      const all = [...states.values()];
      if (all.length >= SUSPICIOUS_MIN && all.every((s) => s === "closed")) {
        suspicious.push(source);
        return;
      }
      for (const [id, state] of states) results.set(id, state);
    })
  );
  return { results, suspicious };
}
