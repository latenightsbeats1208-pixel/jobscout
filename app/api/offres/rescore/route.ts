import { NextResponse } from "next/server";
import { getProfile } from "@/lib/db/queries";
import { listOffres, setOffreScore } from "@/lib/db/offres";
import { scoreOffreLocal } from "@/lib/scoring/local";

export const runtime = "nodejs";
export const maxDuration = 120;

// Re-score toutes les offres avec le profil actif.
// Utile après une mise à jour du profil (secteurs, pays, compétences) ou du
// moteur de scoring — le scoring est local et déterministe, donc gratuit.
export async function POST() {
  const profile = getProfile();
  if (!profile) {
    return NextResponse.json({ error: "Aucun profil actif" }, { status: 400 });
  }
  const offres = listOffres();
  let updated = 0;
  for (const o of offres) {
    const result = scoreOffreLocal(profile, {
      title: o.title,
      company: o.company,
      country: o.country,
      description_text: o.description_text,
      contract_type: o.contract_type,
    });
    setOffreScore(o.id, result);
    updated++;
  }
  return NextResponse.json({ ok: true, rescored: updated });
}
