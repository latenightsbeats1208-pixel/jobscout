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
  if (body?.status != null && !STATUS.includes(body.status)) {
    return NextResponse.json({ error: "statut invalide" }, { status: 400 });
  }
  for (const field of ["deadline", "follow_up_date"] as const) {
    if (body[field] != null && !isDateOnly(body[field])) {
      return NextResponse.json({ error: `date ${field} invalide` }, { status: 400 });
    }
  }
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
  for (const field of ["deadline", "follow_up_date"] as const) {
    if (patch[field] != null && !isDateOnly(patch[field])) {
      return NextResponse.json({ error: `date ${field} invalide` }, { status: 400 });
    }
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

function isDateOnly(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
