import { NextRequest, NextResponse } from "next/server";
import { previousSearchOffres, setCurrentSearchOnly } from "@/lib/db/offres";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Masquer ou afficher les offres d'une recherche précédente : POST { enabled }. Rien n'est effacé. */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { enabled?: unknown };
  if (typeof body.enabled !== "boolean") return NextResponse.json({ error: "Valeur attendue : enabled (vrai ou faux)" }, { status: 400 });
  setCurrentSearchOnly(body.enabled);
  return NextResponse.json({ previous: previousSearchOffres() });
}
