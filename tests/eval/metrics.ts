/**
 * Mesures de classement des bancs d'évaluation. Les égalités de note comptent
 * en espérance : un groupe d'offres à égalité qui chevauche le rang k contribue
 * au prorata de sa place.
 */

export type Ranked = { score: number; rel: number; excluded: boolean }[];

/** Groupes d'égalité, du meilleur score au moins bon. */
function tieGroups(items: Ranked): Ranked[] {
  const sorted = [...items].sort((a, b) => b.score - a.score);
  const groups: Ranked[] = [];
  for (const it of sorted) {
    const last = groups[groups.length - 1];
    if (last && last[0].score === it.score) last.push(it);
    else groups.push([it]);
  }
  return groups;
}

/** Nombre espéré d'offres pertinentes (rel ≥ 1) parmi les k premières. */
function expectedHitsAt(items: Ranked, k: number): number {
  let rank = 0;
  let hits = 0;
  for (const g of tieGroups(items)) {
    const slots = Math.max(0, Math.min(g.length, k - rank));
    if (slots > 0) hits += (g.filter((x) => x.rel >= 1).length * slots) / g.length;
    rank += g.length;
    if (rank >= k) break;
  }
  return hits;
}

/** DCG@k espéré (gain 2^rel − 1), égalités réparties uniformément. */
function expectedDcgAt(items: Ranked, k: number): number {
  let rank = 0;
  let dcg = 0;
  for (const g of tieGroups(items)) {
    let discount = 0;
    for (let j = rank; j < Math.min(rank + g.length, k); j++) discount += 1 / Math.log2(j + 2);
    const gain = g.reduce((s, x) => s + (2 ** x.rel - 1), 0);
    dcg += (gain * discount) / g.length;
    rank += g.length;
    if (rank >= k) break;
  }
  return dcg;
}

function ndcgAt(items: Ranked, k: number): number {
  const ideal = [...items].sort((a, b) => b.rel - a.rel).map((x, i) => ({ ...x, score: -i }));
  const idcg = expectedDcgAt(ideal, k);
  return idcg === 0 ? 0 : expectedDcgAt(items, k) / idcg;
}

export type Metrics = { p10: number; p20: number; ndcg20: number; r50: number; distinct: number; relExcluded: number };

export function metrics(items: Ranked): Metrics {
  const relevant = items.filter((x) => x.rel >= 1).length;
  return {
    p10: expectedHitsAt(items, 10) / 10,
    p20: expectedHitsAt(items, 20) / 20,
    ndcg20: ndcgAt(items, 20),
    r50: relevant ? expectedHitsAt(items, 50) / relevant : 0,
    distinct: new Set(items.map((x) => x.score)).size,
    relExcluded: items.filter((x) => x.excluded && x.rel >= 1).length,
  };
}

export const pct = (x: number) => `${Math.round(x * 100)} %`.padStart(6);
