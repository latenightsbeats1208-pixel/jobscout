import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { scoreOffresLocal } from "@/lib/scoring/local";
import { scoreOffresLocal as legacyScoreOffresLocal } from "./eval/legacy-local";
import { EVAL_PROFILES } from "./eval/profiles";

/**
 * Banc d'évaluation de la note locale : ancienne note contre nouvelle, sur un
 * instantané réel d'offres et des jugements de pertinence posés à la main AVANT
 * l'écriture de la nouvelle note.
 *
 * L'instantané et les jugements sont des données locales (data/ n'est pas
 * versionné) : sans eux, le banc est sauté.
 *   data/eval/jobscout-avant-scoring-v2.db   offres
 *   data/eval/labels.json                    { profil: { "source:source_id": 1 | 2 } }
 *
 * Les égalités de note comptent en espérance : un groupe d'offres à égalité qui
 * chevauche le rang k contribue au prorata de sa place. Un classement plein
 * d'égalités n'est donc ni avantagé ni pénalisé par un ordre arbitraire.
 */

const ROOT = path.join(__dirname, "..");
const SNAPSHOT = path.join(ROOT, "data", "eval", "jobscout-avant-scoring-v2.db");
const LABELS = path.join(ROOT, "data", "eval", "labels.json");
const available = fs.existsSync(SNAPSHOT) && fs.existsSync(LABELS);

type Row = {
  key: string;
  title: string;
  company: string;
  country: string | null;
  description_text: string;
  contract_type: string | null;
};

function loadOffers(): Row[] {
  const db = new DatabaseSync(SNAPSHOT, { readOnly: true });
  const rows = db
    .prepare(
      "SELECT source || ':' || source_id AS key, title, company, country, description_text, contract_type FROM offres ORDER BY id"
    )
    .all() as Row[];
  db.close();
  return rows.map((r) => ({ ...r }));
}

type Ranked = { score: number; rel: number; excluded: boolean }[];

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

type Metrics = { p10: number; p20: number; ndcg20: number; r50: number; distinct: number; relExcluded: number };

function metrics(items: Ranked): Metrics {
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

const pct = (x: number) => `${Math.round(x * 100)} %`.padStart(6);

describe.skipIf(!available)("banc d'évaluation de la note locale", () => {
  it("la nouvelle note classe mieux que l'ancienne", () => {
    const offers = loadOffers();
    const labels = JSON.parse(fs.readFileSync(LABELS, "utf-8")) as Record<string, Record<string, number>>;
    const lines: string[] = [];
    const means = { legacy: 0, v2: 0 };
    let relExcludedTotal = 0;

    lines.push(
      "profil               note     P@10   P@20  NDCG@20   R@50  notes≠  pertinentes écartées"
    );
    for (const { key, profile } of EVAL_PROFILES) {
      const rel = labels[key] ?? {};
      const legacy = legacyScoreOffresLocal(profile, offers);
      const v2 = scoreOffresLocal(profile, offers);
      const rankedLegacy: Ranked = legacy.map((r, i) => ({ score: r.score, rel: rel[offers[i].key] ?? 0, excluded: false }));
      const rankedV2: Ranked = v2.map((r, i) => ({
        score: r.score,
        rel: rel[offers[i].key] ?? 0,
        excluded: !!r.breakdown.excluded,
      }));
      for (const [name, ranked] of [["ancienne", rankedLegacy], ["nouvelle", rankedV2]] as const) {
        const m = metrics(ranked);
        if (name === "ancienne") means.legacy += m.ndcg20 / EVAL_PROFILES.length;
        else {
          means.v2 += m.ndcg20 / EVAL_PROFILES.length;
          relExcludedTotal += m.relExcluded;
        }
        lines.push(
          `${(name === "ancienne" ? key : "").padEnd(20)} ${name}  ${pct(m.p10)} ${pct(m.p20)}  ${pct(m.ndcg20)}  ${pct(m.r50)}  ${String(m.distinct).padStart(6)}  ${name === "nouvelle" ? String(m.relExcluded).padStart(4) : "   –"}`
        );
      }

      if (process.env.EVAL_VERBOSE === "1") {
        const top = v2
          .map((r, i) => ({ r, o: offers[i], rel: rel[offers[i].key] ?? 0 }))
          .sort((a, b) => b.r.score - a.r.score)
          .slice(0, 12);
        for (const { r, o, rel: g } of top) {
          lines.push(`    ${String(r.score).padStart(3)} [${g}] ${o.title.slice(0, 70)} — ${r.reason.slice(0, 90)}`);
        }
        const wronglyExcluded = v2
          .map((r, i) => ({ r, o: offers[i], rel: rel[offers[i].key] ?? 0 }))
          .filter((x) => x.r.breakdown.excluded && x.rel >= 1);
        for (const { r, o, rel: g } of wronglyExcluded) {
          lines.push(`    écartée [${g}] ${o.title.slice(0, 60)} — ${r.breakdown.excluded}`);
        }
      }
    }
    lines.push(`NDCG@20 moyen : ancienne ${pct(means.legacy)}, nouvelle ${pct(means.v2)}`);
    console.log(`\n${lines.join("\n")}\n`);

    expect(means.v2).toBeGreaterThan(means.legacy);
    // Garde-fou du filtre d'expérience : il ne doit écarter qu'exceptionnellement
    // une offre jugée pertinente.
    expect(relExcludedTotal).toBeLessThanOrEqual(3);
  });
});
