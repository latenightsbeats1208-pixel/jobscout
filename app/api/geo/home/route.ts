import { NextRequest, NextResponse } from "next/server";
import { getDistanceHome, setDistanceHome, suggestedDistanceHome } from "@/lib/distance/home";
import { geoStatus } from "@/lib/geo";

export const runtime = "nodejs";

/** Ville de référence du filtre par distance, et commune proposée d'après le profil. */
export async function GET() {
  const home = getDistanceHome();
  return NextResponse.json({ home, suggestion: home ? null : suggestedDistanceHome() }, { headers: { "Cache-Control": "no-store" } });
}

/** { code: "69123" } enregistre la ville ; { code: null } l'efface. */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { code?: unknown } | null;
  if (!geoStatus().ok) {
    return NextResponse.json({ error: "Base géographique indisponible : redémarrez JobScout." }, { status: 503 });
  }
  const code = body?.code;
  if (code !== null && typeof code !== "string") {
    return NextResponse.json({ error: "Commune manquante." }, { status: 400 });
  }
  try {
    const home = setDistanceHome(code ? code.slice(0, 10) : null);
    return NextResponse.json({ home });
  } catch {
    return NextResponse.json({ error: "Commune inconnue : choisissez-la dans la liste proposée." }, { status: 400 });
  }
}
