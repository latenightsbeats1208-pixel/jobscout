import { NextRequest, NextResponse } from "next/server";
import { setSetting } from "@/lib/db";
import { getLlmConfig } from "@/lib/ai/client";
import { AUTO_REVIEW_LIMIT, AUTO_REVIEW_SETTING, autoReviewEnabled } from "@/lib/ai/review-top";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Relecture automatique après chaque scan : GET l'état, POST { enabled } le change. */
export async function GET() {
  return NextResponse.json({ enabled: autoReviewEnabled(), configured: getLlmConfig().mode !== "unset", limit: AUTO_REVIEW_LIMIT });
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { enabled?: unknown };
  if (typeof body.enabled !== "boolean") return NextResponse.json({ error: "Valeur attendue : enabled (vrai ou faux)" }, { status: 400 });
  setSetting(AUTO_REVIEW_SETTING, body.enabled ? "1" : "0");
  return NextResponse.json({ enabled: autoReviewEnabled() });
}
