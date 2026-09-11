import { NextRequest, NextResponse } from "next/server";
import { getProfile } from "@/lib/db/queries";
import { getOffre } from "@/lib/db/offres";
import { generateMsgVie } from "@/lib/ai/generate-msg-vie";
import { genericFailure, translateAiError } from "@/lib/ai/errors";
import { saveDocument, offreFolderPath } from "@/lib/db/documents";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const { offreId } = await req.json();
    const profile = getProfile();
    if (!profile) return NextResponse.json({ error: "Profil introuvable" }, { status: 400 });
    const offre = getOffre(Number(offreId));
    if (!offre) return NextResponse.json({ error: "Offre introuvable" }, { status: 404 });
    if (!offre.is_vie) return NextResponse.json({ error: "Offre non V.I.E" }, { status: 400 });

    const text = await generateMsgVie(profile, offre);
    const meta = { company: offre.company, title: offre.title };
    const doc = saveDocument({
      type: "msg",
      offreId: offre.id,
      format: "txt",
      buffer: text,
      meta,
    });
    return NextResponse.json({
      ok: true,
      document_id: doc.id,
      text,
      length: text.length,
      folder: offreFolderPath(offre.id, offre.company, offre.title),
    });
  } catch (e) {
    const ai = translateAiError(e);
    if (ai) return NextResponse.json({ error: ai.message }, { status: ai.status });
    return NextResponse.json(
      { error: genericFailure("generate/msg", e) },
      { status: 500 }
    );
  }
}
