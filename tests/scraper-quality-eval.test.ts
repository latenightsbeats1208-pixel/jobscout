import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { assessQuality, type QualityIssue } from "@/lib/scrapers/quality";

/**
 * Le contrôle de qualité sur l'instantané réel (data/eval, local, non versionné) :
 * il doit repérer les descriptions France Travail d'un autre poste sans
 * soupçonner les sources saines (Welcome to the Jungle, HelloWork).
 */

const SNAPSHOT = path.join(__dirname, "..", "data", "eval", "jobscout-avant-scoring-v2.db");

// Les 18 offres France Travail dont la description décrit un autre poste,
// relevées à la main (titre contre début de la description) le 11/10/2026.
const KNOWN_MISMATCHES = [19, 15, 14, 13, 12, 11, 10, 9, 8, 40, 1, 38, 37, 21, 50, 47, 45, 42];

type Row = { id: number; source: string; title: string; company: string; location: string | null; posted_at: string | null; description_text: string; description_html: string; description_status: "ok" | "partial" | "failed" };

describe.skipIf(!fs.existsSync(SNAPSHOT))("contrôle de qualité sur l'instantané réel", () => {
  it("repère les descriptions d'un autre poste sans soupçonner les sources saines", () => {
    const db = new DatabaseSync(SNAPSHOT, { readOnly: true });
    const rows = db.prepare("SELECT id, source, title, company, location, posted_at, description_text, description_html, description_status FROM offres").all() as Row[];
    db.close();

    const bySource = new Map<string, { n: number; failed: number; issues: Partial<Record<QualityIssue, number>> }>();
    const flagged = new Set<number>();
    const healthyFlagged: string[] = [];
    for (const r of rows) {
      const q = assessQuality({ ...r });
      const s = bySource.get(r.source) ?? { n: 0, failed: 0, issues: {} };
      s.n++;
      if (q.status === "failed") s.failed++;
      for (const i of q.issues) s.issues[i] = (s.issues[i] ?? 0) + 1;
      bySource.set(r.source, s);
      if (q.issues.includes("description_sans_rapport") || q.issues.includes("page_de_resultats")) {
        flagged.add(r.id);
        if (r.source === "wttj" || r.source === "hellowork") healthyFlagged.push(`${r.source} #${r.id} ${r.title}`);
      }
    }
    const caught = KNOWN_MISMATCHES.filter((id) => flagged.has(id));
    console.log(
      `\n${[...bySource].map(([src, s]) => `${src.padEnd(14)} ${String(s.n).padStart(4)} offres, ${String(s.failed).padStart(3)} écartées — ${JSON.stringify(s.issues)}`).join("\n")}\n` +
        `France Travail : ${caught.length}/${KNOWN_MISMATCHES.length} descriptions d'un autre poste repérées` +
        `${KNOWN_MISMATCHES.length - caught.length ? ` (manquées : ${KNOWN_MISMATCHES.filter((id) => !flagged.has(id)).join(", ")})` : ""}\n` +
        `Sources saines soupçonnées à tort : ${healthyFlagged.length}${healthyFlagged.length ? `\n  ${healthyFlagged.join("\n  ")}` : ""}\n`
    );

    expect(caught.length).toBeGreaterThanOrEqual(15);
    const healthy = (bySource.get("wttj")?.n ?? 0) + (bySource.get("hellowork")?.n ?? 0);
    expect(healthyFlagged.length / healthy).toBeLessThanOrEqual(0.02);
  });
});
