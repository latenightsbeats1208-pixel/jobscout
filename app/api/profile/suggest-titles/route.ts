import { NextRequest, NextResponse } from "next/server";
import { getProfile } from "@/lib/db/queries";
import { ProfileFullSchema } from "@/lib/cv/types";
import { getLlmConfig } from "@/lib/ai/client";
import { genericFailure, translateAiError } from "@/lib/ai/errors";
import { suggestTitles } from "@/lib/ai/suggest-titles";
import { localTitleSuggestions } from "@/lib/cv/title-suggestions";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * Postes à viser suggérés à partir du CV. Corps facultatif { profile } : le
 * profil en cours d'édition (onboarding, profil non enregistré), sinon celui de
 * la base. Rien n'est enregistré. Sans IA configurée : les intitulés des
 * expériences, et un message qui le dit.
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as { profile?: unknown };
    const parsed = body.profile ? ProfileFullSchema.safeParse(body.profile) : null;
    const profile = parsed?.success ? parsed.data : getProfile();
    if (!profile) return NextResponse.json({ error: "Profil introuvable" }, { status: 400 });

    if (getLlmConfig().mode === "unset") {
      return NextResponse.json({
        suggestions: localTitleSuggestions(profile),
        notice: "IA non configurée : seuls les intitulés de vos expériences sont proposés. Configurez l'IA dans Profil › Génération IA pour des suggestions de postes voisins.",
      });
    }
    return NextResponse.json({ suggestions: await suggestTitles(profile) });
  } catch (e) {
    const ai = translateAiError(e);
    if (ai) return NextResponse.json({ error: ai.message }, { status: ai.status });
    return NextResponse.json({ error: genericFailure("profile/suggest-titles", e) }, { status: 500 });
  }
}
