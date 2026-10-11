import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { scoreOffresLocal } from "@/lib/scoring/local";
import { descriptionExcerpt } from "@/lib/ai/review-offres";
import { isReviewCurrent, offerHash, profileHash, type AiReview } from "@/lib/scoring/review";
import { EVAL_PROFILES } from "./eval/profiles";
import { metrics, pct, type Ranked } from "./eval/metrics";

/**
 * Banc de la relecture par l'IA : note locale seule, contre note locale +
 * relecture des 30 premières offres, sur le même instantané et les mêmes
 * jugements que tests/scoring-eval.test.ts.
 *
 * PAYANT, et seulement sur demande : EVAL_AI=1, avec un serveur JobScout
 * démarré avec JOBSCOUT_EVAL=1 (la route /api/eval/review utilise la
 * configuration d'IA de l'application ; le banc ne voit aucune clé).
 * Chaque relecture est gardée dans data/eval/ai-reviews.json : relancer le
 * banc ne repaie que ce qui manque.
 */

const ROOT = path.join(__dirname, "..");
const SNAPSHOT = path.join(ROOT, "data", "eval", "jobscout-avant-scoring-v2.db");
const LABELS = path.join(ROOT, "data", "eval", "labels.json");
const CACHE = path.join(ROOT, "data", "eval", "ai-reviews.json");
const SERVER = process.env.EVAL_SERVER ?? "http://127.0.0.1:3000";
const HEAD = 30;
const enabled = process.env.EVAL_AI === "1" && fs.existsSync(SNAPSHOT) && fs.existsSync(LABELS);

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
    .prepare("SELECT source || ':' || source_id AS key, title, company, country, location, description_text, contract_type FROM offres ORDER BY id")
    .all() as Row[];
  db.close();
  return rows.map((r) => ({ ...r }));
}

describe.skipIf(!enabled)("banc de la relecture par l'IA", () => {
  it("la relecture des premières offres améliore le classement", { timeout: 3_600_000 }, async () => {
    const offers = loadOffers();
    const labels = JSON.parse(fs.readFileSync(LABELS, "utf-8")) as Record<string, Record<string, number>>;
    const cache = (fs.existsSync(CACHE) ? JSON.parse(fs.readFileSync(CACHE, "utf-8")) : {}) as Record<string, Record<string, AiReview>>;
    const lines = ["profil               note          P@10   P@20  NDCG@20   R@50  pertinentes écartées"];
    const means = { local: 0, ai: 0 };
    let sentChars = 0;
    let calls = 0;

    for (const { key, profile } of EVAL_PROFILES) {
      const rel = labels[key] ?? {};
      const pHash = profileHash(profile);
      const local = scoreOffresLocal(profile, offers);
      const head = local
        .map((r, i) => ({ r, i }))
        .filter((x) => !x.r.breakdown.excluded)
        .sort((a, b) => b.r.score - a.r.score)
        .slice(0, HEAD)
        .map((x) => x.i);

      cache[key] ??= {};
      const todo = head.filter((i) => !isReviewCurrent(cache[key][offers[i].key], pHash, offerHash(offers[i])));
      if (todo.length) {
        const res = await fetch(`${SERVER}/api/eval/review`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ profile, offres: todo.map((i) => offers[i]) }),
        });
        const data = (await res.json()) as { reviews?: (AiReview | null)[]; error?: string };
        if (!res.ok || !data.reviews) throw new Error(`Relecture impossible : ${data.error ?? res.status}`);
        data.reviews.forEach((review, j) => {
          if (review) cache[key][offers[todo[j]].key] = review;
        });
        fs.writeFileSync(CACHE, JSON.stringify(cache, null, 1));
        calls += Math.ceil(todo.length / 8);
        sentChars += todo.reduce((s, i) => s + descriptionExcerpt(offers[i].description_text).length, 0);
      }

      const reviews = offers.map((o) => (isReviewCurrent(cache[key][o.key], pHash, offerHash(o)) ? cache[key][o.key] : null));
      const withAi = scoreOffresLocal(profile, offers, undefined, reviews);
      const rank = (res: typeof local): Ranked =>
        res.map((r, i) => ({ score: r.score, rel: rel[offers[i].key] ?? 0, excluded: !!r.breakdown.excluded }));
      const mLocal = metrics(rank(local));
      const mAi = metrics(rank(withAi));
      means.local += mLocal.ndcg20 / EVAL_PROFILES.length;
      means.ai += mAi.ndcg20 / EVAL_PROFILES.length;
      lines.push(`${key.padEnd(20)} locale      ${pct(mLocal.p10)} ${pct(mLocal.p20)}  ${pct(mLocal.ndcg20)}  ${pct(mLocal.r50)}  ${String(mLocal.relExcluded).padStart(4)}`);
      lines.push(`${"".padEnd(20)} locale + IA ${pct(mAi.p10)} ${pct(mAi.p20)}  ${pct(mAi.ndcg20)}  ${pct(mAi.r50)}  ${String(mAi.relExcluded).padStart(4)}`);

      if (process.env.EVAL_VERBOSE === "1") {
        const top = withAi
          .map((r, i) => ({ r, o: offers[i], g: rel[offers[i].key] ?? 0, rv: reviews[i] }))
          .sort((a, b) => b.r.score - a.r.score)
          .slice(0, 12);
        for (const { r, o, g, rv } of top) {
          lines.push(`    ${String(r.score).padStart(3)} [${g}] ${(rv?.verdict ?? "—").padEnd(11)} ${o.title.slice(0, 55)} — ${(rv?.reason ?? r.reason).slice(0, 80)}`);
        }
        withAi.forEach((r, i) => {
          const g = rel[offers[i].key] ?? 0;
          if (g >= 1 && r.breakdown.excluded?.startsWith("compétences")) {
            lines.push(`    écartée par l'IA [${g}] ${offers[i].title.slice(0, 50)} — ${r.breakdown.excluded}`);
          }
        });
      }
    }
    lines.push(`NDCG@20 moyen : locale ${pct(means.local)}, locale + IA ${pct(means.ai)}`);
    if (calls) lines.push(`Cette exécution : ${calls} appels, environ ${Math.round(sentChars / 4 / 1000)} k jetons d'annonces envoyés (hors profil et consignes).`);
    console.log(`\n${lines.join("\n")}\n`);
    expect(means.ai).toBeGreaterThan(0);
  });
});
