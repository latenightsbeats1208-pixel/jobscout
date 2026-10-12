import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { CHECKABLE_SOURCES, checkLiveness, type LivenessRef } from "@/lib/scrapers/liveness";
import { applyLiveness } from "@/lib/scrapers/liveness-store";

export const runtime = "nodejs";

/** Une offre vérifiée depuis moins longtemps n'est pas revérifiée à l'ouverture de sa page. */
const FRESH_HOURS = 6;

type Row = LivenessRef & { closed_at: string | null; checked_at: string | null; fresh: number };

function state(row: Pick<Row, "closed_at" | "checked_at">, checkable: boolean) {
  return { checkable, closed_at: row.closed_at, checked_at: row.checked_at };
}

/**
 * L'offre est-elle toujours en ligne ? Vérifiée à l'ouverture de sa page (au
 * plus une fois toutes les FRESH_HOURS heures), ou sur demande avec { force: true }.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  const read = () =>
    getDb()
      .prepare(
        `SELECT id, source, source_id, url, closed_at, checked_at,
           (checked_at IS NOT NULL AND checked_at >= datetime('now', '-${FRESH_HOURS} hours')) AS fresh
         FROM offres WHERE id = ?`
      )
      .get(id) as Row | undefined;
  const row = Number.isInteger(id) ? read() : undefined;
  if (!row) return NextResponse.json({ error: "Offre introuvable" }, { status: 404 });

  const checkable = CHECKABLE_SOURCES.has(row.source);
  const body = (await req.json().catch(() => ({}))) as { force?: unknown };
  if (!checkable || (row.fresh && body.force !== true)) return NextResponse.json(state(row, checkable));

  const { results } = await checkLiveness([row]);
  applyLiveness(results);
  return NextResponse.json({ ...state(read() ?? row, checkable), result: results.get(row.id) ?? "unknown" });
}
