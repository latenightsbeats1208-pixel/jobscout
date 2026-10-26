import { NextRequest, NextResponse } from "next/server";
import { CONTRACT_ORDER, type ContractCategory } from "@/lib/contracts";
import { parseMinScore, searchOffres, type OffersSort } from "@/lib/db/offres";
import { getDistanceHome } from "@/lib/distance/home";
import { isDistanceRadius } from "@/lib/distance/format";
import { getSearchZones } from "@/lib/zones-store";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const allowedContracts = new Set<string>(CONTRACT_ORDER);
  const contracts = (params.get("contracts") ?? "").split(",")
    .filter((value): value is ContractCategory => allowedContracts.has(value));
  const sort = params.get("sort");
  const sortBy: OffersSort = sort === "newest" || sort === "oldest" || sort === "score" || sort === "distance" ? sort : "smart";
  // Rayon en km (?radius=20, 0 = dans la commune) : seulement les valeurs du menu.
  const radius = (params.get("radius") ?? "").trim();
  const radiusKm = /^\d{1,3}$/.test(radius) && isDistanceRadius(Number(radius)) ? Number(radius) : null;
  const page = Number(params.get("page") ?? "1");
  const result = searchOffres({
    query: (params.get("q") ?? "").slice(0, 200),
    source: params.get("source") ?? "",
    country: params.get("country") ?? "",
    contracts,
    minScore: parseMinScore(params.get("minScore")),
    // ?vie=1 (lien de l'accueil) : même règle que la puce contrat « V.I.E ».
    vieOnly: params.get("vie") === "1",
    sortBy,
    // Ville de référence lue côté serveur : ses coordonnées ne passent jamais dans l'URL.
    home: getDistanceHome(),
    radiusKm,
    includeUnlocated: params.get("unlocated") === "1",
    // Zones choisies (Profil › Recherche), lues côté serveur ; ?zones=1 n'en garde que les offres.
    zones: getSearchZones(),
    zonesOnly: params.get("zones") === "1",
    page: Number.isFinite(page) ? page : 1,
  });
  return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
}
