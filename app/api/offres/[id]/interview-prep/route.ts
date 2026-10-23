import { NextResponse } from "next/server";
import { getOffre } from "@/lib/db/offres";
import { getProfile } from "@/lib/db/queries";
import { generateInterviewPrep } from "@/lib/ai/interview-prep";
import { genericFailure, translateAiError } from "@/lib/ai/errors";

export const runtime = "nodejs";
export const maxDuration = 180;

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const offre = getOffre(Number(id));
    if (!offre) return NextResponse.json({ error: "Offre introuvable" }, { status: 404 });
    const profile = getProfile();
    if (!profile) return NextResponse.json({ error: "Profil introuvable" }, { status: 400 });
    const prep = await generateInterviewPrep(profile, offre);
    return NextResponse.json({ prep, experiences: profile.experiences.map((item) => item.title) });
  } catch (error) {
    const ai = translateAiError(error);
    if (ai) return NextResponse.json({ error: ai.message }, { status: ai.status });
    return NextResponse.json({ error: genericFailure("interview-prep", error) }, { status: 500 });
  }
}
