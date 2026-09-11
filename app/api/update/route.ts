import { NextResponse } from "next/server";
import { getUpdateStatus } from "@/lib/update/check";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Version courante + disponibilité d'une mise à jour.
 * Le résultat distant est mis en cache pour toute la durée de vie du process :
 * une seule requête réseau par démarrage.
 */
export async function GET() {
  return NextResponse.json(await getUpdateStatus());
}
