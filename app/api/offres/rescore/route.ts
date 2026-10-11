import { NextResponse } from "next/server";
import { getProfile } from "@/lib/db/queries";
import { rescoreAllOffres } from "@/lib/scoring/rescore";

export const runtime = "nodejs";
export const maxDuration = 120;

// Re-score toutes les offres avec le profil actif.
// Utile après une mise à jour du profil (postes visés, secteurs, pays, compétences)
// ou du moteur de scoring — le scoring est local et déterministe, donc gratuit.
export async function POST() {
  const profile = getProfile();
  if (!profile) {
    return NextResponse.json({ error: "Aucun profil actif" }, { status: 400 });
  }
  return NextResponse.json({ ok: true, rescored: rescoreAllOffres(profile) });
}
