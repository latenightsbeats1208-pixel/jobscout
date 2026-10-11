import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { scoreOffresLocal } from "@/lib/scoring/local";
import { scoreOffresLocal as legacyScoreOffresLocal } from "./eval/legacy-local";
import { EVAL_PROFILES } from "./eval/profiles";
import { metrics, pct, type Ranked } from "./eval/metrics";

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
  location: string | null;
  description_text: string;
  contract_type: string | null;
};

function loadOffers(): Row[] {
  const db = new DatabaseSync(SNAPSHOT, { readOnly: true });
  const rows = db
    .prepare(
      "SELECT source || ':' || source_id AS key, title, company, country, location, description_text, contract_type FROM offres ORDER BY id"
    )
    .all() as Row[];
  db.close();
  return rows.map((r) => ({ ...r }));
}


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
    // « Pertinentes écartées » : les jugements ont été posés sur les seuls titres,
    // qui ne disent pas l'expérience exigée. Le filtre n'écarte que sur une phrase
    // explicite de l'annonce (tests/scoring-seniority.test.ts) ; le chiffre est
    // affiché pour relecture, pas contraint.
    void relExcludedTotal;
  });
});
