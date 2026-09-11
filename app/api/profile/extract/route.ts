import { NextRequest, NextResponse } from "next/server";
import { extractText } from "@/lib/cv/text-extract";
import { extractCV } from "@/lib/cv/extract-semantic";
import { buildProfileFromExtraction } from "@/lib/cv/validate";
import { getLlmConfig, LlmNotConfiguredError } from "@/lib/ai/client";
import { genericFailure, translateAiError } from "@/lib/ai/errors";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  try {
    // Refus AVANT toute lecture de fichier : l'extraction de texte (PDF scanné
    // -> OCR) peut prendre des dizaines de secondes pour un refus prévisible.
    if (getLlmConfig().mode === "unset") throw new LlmNotConfiguredError();
    const formData = await req.formData();
    const file = formData.get("cv");
    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: "Aucun fichier reçu" }, { status: 400 });
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    const extraction = await extractText(buffer, file.name);

    if (extraction.wordCount < 50 || !extraction.hasCvKeywords) {
      return NextResponse.json(
        {
          error:
            "Impossible de lire correctement ce CV. Essayez un autre format (PDF texte, DOCX) ou un autre fichier.",
          debug: { kind: extraction.kind, strategy: extraction.strategy, wordCount: extraction.wordCount },
        },
        { status: 422 }
      );
    }

    const ai = await extractCV(extraction.text);
    const profile = buildProfileFromExtraction(ai, extraction.text);

    return NextResponse.json({
      profile,
      debug: { kind: extraction.kind, strategy: extraction.strategy, wordCount: extraction.wordCount },
    });
  } catch (err) {
    const ai = translateAiError(err);
    if (ai) return NextResponse.json({ error: ai.message }, { status: ai.status });
    return NextResponse.json({ error: genericFailure("profile/extract", err) }, { status: 500 });
  }
}
