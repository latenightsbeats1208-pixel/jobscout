import { NextResponse } from "next/server";
import { getProfile } from "@/lib/db/queries";
import { rescoreAllOffres } from "@/lib/scoring/rescore";
import { recheckStoredQuality } from "@/lib/scrapers/quality-store";

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
  const quality = recheckStoredQuality();
  return NextResponse.json({ ok: true, quality, rescored: rescoreAllOffres(profile) });
}
