import { NextRequest, NextResponse } from "next/server";
import { saveProfile, getProfile } from "@/lib/db/queries";
import { setSetting } from "@/lib/db";
import { ProfileFullSchema } from "@/lib/cv/types";
import { rescoreAllOffres } from "@/lib/scoring/rescore";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ profile: getProfile() });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const parsed = ProfileFullSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Profil invalide", details: parsed.error.flatten() }, { status: 400 });
  }
  const id = saveProfile(parsed.data);
  setSetting("has_completed_onboarding", "true");
  // Postes visés, compétences, pays… : les notes en dépendent. Recalcul local et
  // immédiat, plutôt que d'attendre le prochain scan.
  const saved = getProfile();
  if (saved) {
    try {
      rescoreAllOffres(saved);
    } catch {
      // Une note périmée ne doit pas faire échouer l'enregistrement du profil.
    }
  }
  return NextResponse.json({ id, ok: true });
}
