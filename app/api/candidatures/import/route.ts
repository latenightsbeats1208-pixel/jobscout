import { NextRequest, NextResponse } from "next/server";
import { xlsxToCandidatures } from "@/lib/excel/io";
import { createCandidature } from "@/lib/db/candidatures";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const fd = await req.formData();
  const file = fd.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "fichier manquant" }, { status: 400 });
  }
  const buf = Buffer.from(await file.arrayBuffer());
  const rows = xlsxToCandidatures(buf);
  let imported = 0;
  for (const r of rows) {
    if (!r.ext_company && !r.ext_title) continue;
    createCandidature({ offre_id: null, ...r });
    imported++;
  }
  return NextResponse.json({ ok: true, imported });
}
