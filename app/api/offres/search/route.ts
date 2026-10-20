import { NextRequest, NextResponse } from "next/server";
import { CONTRACT_ORDER, type ContractCategory } from "@/lib/contracts";
import { parseMinScore, searchOffres, type OffersSort } from "@/lib/db/offres";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const allowedContracts = new Set<string>(CONTRACT_ORDER);
  const contracts = (params.get("contracts") ?? "").split(",")
    .filter((value): value is ContractCategory => allowedContracts.has(value));
  const sort = params.get("sort");
  const sortBy: OffersSort = sort === "newest" || sort === "oldest" || sort === "score" ? sort : "smart";
  const page = Number(params.get("page") ?? "1");
  const result = searchOffres({
    query: (params.get("q") ?? "").slice(0, 200),
    source: params.get("source") ?? "",
    country: params.get("country") ?? "",
    contracts,
    minScore: parseMinScore(params.get("minScore")),
    // ?vie=1 (lien de l'accueil) : même règle que la puce contrat « V.I.E ».
    vieOnly: params.get("vie") === "1",
    includeClosed: params.get("closed") === "1",
    sortBy,
    page: Number.isFinite(page) ? page : 1,
  });
  return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
}
