import { NextRequest, NextResponse } from "next/server";
import { extractText } from "@/lib/cv/text-extract";
import { scoreAts } from "@/lib/ats/score";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("cv");
    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: "Aucun fichier reçu" }, { status: 400 });
    }
    const targetTitle =
      (formData.get("targetTitle") as string | null)?.toString().trim() || null;
    const buffer = Buffer.from(await file.arrayBuffer());
    const extraction = await extractText(buffer, file.name);
    if (extraction.wordCount < 20) {
      return NextResponse.json(
        {
          error:
            "Impossible de lire ce fichier (texte non extractible). Essayez un PDF textuel ou un DOCX.",
          debug: { kind: extraction.kind, strategy: extraction.strategy, wordCount: extraction.wordCount },
        },
        { status: 422 }
      );
    }
    const result = scoreAts(extraction.text, targetTitle);
    return NextResponse.json({
      score: result,
      debug: { kind: extraction.kind, strategy: extraction.strategy, wordCount: extraction.wordCount },
    });
  } catch (err) {
    console.error("[api/ats/score]", err);
    return NextResponse.json(
      { error: "Analyse impossible — réessayez avec un autre fichier." },
      { status: 500 }
    );
  }
}
