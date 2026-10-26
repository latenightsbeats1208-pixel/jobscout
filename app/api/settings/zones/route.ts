import { NextRequest, NextResponse } from "next/server";
import { ZONES, ZONE_IDS } from "@/lib/zones";
import { getSearchZoneIds, setSearchZoneIds } from "@/lib/zones-store";

export const runtime = "nodejs";

const catalogue = () => ZONE_IDS.map((id) => ({ id, label: ZONES[id].label, places: ZONES[id].centers.map((c) => c.name) }));

export async function GET() {
  return NextResponse.json({ zones: getSearchZoneIds(), catalogue: catalogue() });
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { zones?: unknown };
  if (!Array.isArray(body.zones)) return NextResponse.json({ error: "Liste de zones attendue." }, { status: 400 });
  return NextResponse.json({ zones: setSearchZoneIds(body.zones), catalogue: catalogue() });
}
