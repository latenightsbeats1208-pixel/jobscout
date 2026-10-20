import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getFeedback, setFeedback } from "@/lib/db/feedback";
import { isFeedbackReason } from "@/lib/feedback";

export const runtime = "nodejs";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  return NextResponse.json({ feedback: Number.isInteger(id) ? getFeedback(id) : null });
}

/** { verdict: "up" | "down" | null, reason?: string } — null retire l'avis. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  if (!Number.isInteger(id) || !getDb().prepare("SELECT 1 FROM offres WHERE id = ?").get(id)) {
    return NextResponse.json({ error: "Offre introuvable" }, { status: 404 });
  }
  const body = (await req.json().catch(() => ({}))) as { verdict?: unknown; reason?: unknown };
  if (body.verdict !== null && body.verdict !== "up" && body.verdict !== "down") {
    return NextResponse.json({ error: "Avis invalide" }, { status: 400 });
  }
  // Un motif n'a de sens que pour un 👎.
  const reason = body.verdict === "down" && isFeedbackReason(body.reason) ? body.reason : null;
  const feedback = setFeedback(id, body.verdict === null ? null : { verdict: body.verdict, reason });
  return NextResponse.json({ feedback });
}
