import { NextResponse } from "next/server";
import { computeFeedbackStats } from "@/lib/scoring/feedback-stats";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Accord entre la note et les avis 👍 / 👎 de l'utilisateur. */
export async function GET() {
  return NextResponse.json(computeFeedbackStats());
}
