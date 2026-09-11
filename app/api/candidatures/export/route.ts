import { NextResponse } from "next/server";
import { listCandidatures } from "@/lib/db/candidatures";
import { candidaturesToXlsx } from "@/lib/excel/io";

export const runtime = "nodejs";

export async function GET() {
  const buf = candidaturesToXlsx(listCandidatures());
  // Buffer n'est pas un BodyInit valide pour l'API Web Response : on passe par un Uint8Array.
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="candidatures-${new Date().toISOString().split("T")[0]}.xlsx"`,
    },
  });
}
