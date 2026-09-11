import { NextRequest, NextResponse } from "next/server";
import {
  listCandidatures,
  createCandidature,
  updateCandidature,
  deleteCandidature,
  STATUS,
} from "@/lib/db/candidatures";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ candidatures: listCandidatures() });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const id = createCandidature(body);
  return NextResponse.json({ id, ok: true });
}

export async function PATCH(req: NextRequest) {
  const body = await req.json();
  const { id, ...patch } = body;
  if (!id) return NextResponse.json({ error: "id requis" }, { status: 400 });
  if (patch.status && !STATUS.includes(patch.status)) {
    return NextResponse.json({ error: "statut invalide" }, { status: 400 });
  }
  updateCandidature(Number(id), patch);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const id = Number(searchParams.get("id"));
  if (!id) return NextResponse.json({ error: "id requis" }, { status: 400 });
  deleteCandidature(id);
  return NextResponse.json({ ok: true });
}
