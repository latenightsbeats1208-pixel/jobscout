import { NextRequest, NextResponse } from "next/server";
import { listOffres, offresCounts } from "@/lib/db/offres";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const country = searchParams.get("country") || undefined;
  const source = searchParams.get("source") || undefined;
  const vieOnly = searchParams.get("vie") === "1";
  const minScore = searchParams.get("minScore") ? Number(searchParams.get("minScore")) : undefined;
  const offres = listOffres({ country, source, vieOnly, minScore });
  const counts = offresCounts();
  return NextResponse.json({ offres, counts });
}
