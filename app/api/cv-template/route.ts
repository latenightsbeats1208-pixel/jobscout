import { NextRequest, NextResponse } from "next/server";
import { deleteCvTemplate, getCvTemplate, saveCvTemplate } from "@/lib/cvtemplate/store";
import { missingEnglish, templatePlaceholders } from "@/lib/cvtemplate/inspect";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function summary() {
  const template = getCvTemplate();
  if (!template) return { template: null, placeholders: [], missingEnglish: [] };
  return { template, placeholders: templatePlaceholders(template), missingEnglish: missingEnglish(template) };
}

export async function GET() {
  return NextResponse.json(summary());
}

/** Remplace le modèle (JSON complet, validé). */
export async function PUT(req: NextRequest) {
  const body = await req.json().catch(() => undefined);
  if (body === undefined) return NextResponse.json({ error: "JSON illisible." }, { status: 400 });
  const r = saveCvTemplate(body);
  if (!r.ok) return NextResponse.json({ error: "Modèle invalide.", errors: r.errors }, { status: 400 });
  return NextResponse.json({ ok: true, ...summary() });
}

export async function DELETE() {
  deleteCvTemplate();
  return NextResponse.json({ ok: true });
}
