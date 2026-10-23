import { NextRequest, NextResponse } from "next/server";
import { geoStatus, suggestCommunes } from "@/lib/geo";

export const runtime = "nodejs";

/** Suggestions de communes pour la ville de référence (base embarquée, aucun appel extérieur). */
export async function GET(req: NextRequest) {
  if (!geoStatus().ok) {
    return NextResponse.json({ error: "Base géographique indisponible : redémarrez JobScout.", communes: [] }, { status: 503 });
  }
  const q = (req.nextUrl.searchParams.get("q") ?? "").slice(0, 80).trim();
  const communes = q.length >= 2 ? suggestCommunes(q, 8) : [];
  return NextResponse.json({ communes }, { headers: { "Cache-Control": "no-store" } });
}
