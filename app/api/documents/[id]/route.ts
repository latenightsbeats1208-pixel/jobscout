import { NextRequest, NextResponse } from "next/server";
import { getDocument, buildDocFilename } from "@/lib/db/documents";
import { getOffre } from "@/lib/db/offres";
import { getProfile } from "@/lib/db/queries";
import fs from "node:fs";

export const runtime = "nodejs";

// RFC 5987-compatible Content-Disposition: ASCII fallback + UTF-8 filename*
function buildContentDisposition(filename: string): string {
  const ascii = filename
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\x20-\x7E]/g, "_");
  const encoded = encodeURIComponent(filename).replace(/['()]/g, escape);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const doc = getDocument(Number(id));
  if (!doc) return NextResponse.json({ error: "Document introuvable" }, { status: 404 });
  if (!fs.existsSync(doc.file_path))
    return NextResponse.json({ error: "Fichier manquant" }, { status: 404 });

  const profile = getProfile();
  const offre = doc.offre_id ? getOffre(doc.offre_id) : null;
  const filename = buildDocFilename({
    type: doc.type,
    format: doc.format,
    fullName: profile?.full_name ?? null,
    title: offre?.title ?? null,
  });

  const buffer = fs.readFileSync(doc.file_path);
  const mime =
    doc.format === "pdf"
      ? "application/pdf"
      : doc.format === "docx"
      ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      : "text/plain; charset=utf-8";
  return new NextResponse(buffer, {
    headers: {
      "content-type": mime,
      "content-disposition": buildContentDisposition(filename),
    },
  });
}
