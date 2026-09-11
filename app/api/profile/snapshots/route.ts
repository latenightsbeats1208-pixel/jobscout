import { NextRequest, NextResponse } from "next/server";
import { getDb, getSetting, setSetting } from "@/lib/db";
import { getProfile, saveProfile } from "@/lib/db/queries";
import { listOffres, setOffreScore } from "@/lib/db/offres";
import { scoreOffreLocal } from "@/lib/scoring/local";
import { ProfileFullSchema } from "@/lib/cv/types";

export const runtime = "nodejs";
export const maxDuration = 120;

// Snapshots de profils : sauvegarde/restauration instantanée du profil complet
// dans la table settings (clé profile_snapshot:<nom>). Permet de basculer entre
// plusieurs profils (démo, tests, confidentialité) sans ré-extraire de CV.

const PREFIX = "profile_snapshot:";

function sanitizeName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const name = raw.trim().replace(/[\x00-\x1f]/g, "");
  if (!name || name.length > 60) return null;
  return name;
}

export async function GET() {
  const rows = getDb()
    .prepare("SELECT key, value FROM settings WHERE key LIKE ? ORDER BY key")
    .all(`${PREFIX}%`) as { key: string; value: string }[];
  const snapshots = rows.map((r) => {
    let meta: { full_name?: string | null; saved_at?: string } = {};
    try {
      const parsed = JSON.parse(r.value);
      meta = { full_name: parsed?.profile?.full_name ?? null, saved_at: parsed?.saved_at };
    } catch {}
    return { name: r.key.slice(PREFIX.length), ...meta };
  });
  const current = getProfile();
  return NextResponse.json({ snapshots, current_full_name: current?.full_name ?? null });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const action = body.action;
  const name = sanitizeName(body.name);
  if (!name) return NextResponse.json({ error: "Nom de profil invalide" }, { status: 400 });

  if (action === "save") {
    const profile = getProfile();
    if (!profile) return NextResponse.json({ error: "Aucun profil actif" }, { status: 400 });
    setSetting(
      `${PREFIX}${name}`,
      JSON.stringify({ saved_at: new Date().toISOString(), profile })
    );
    return NextResponse.json({ ok: true, saved: name });
  }

  if (action === "load") {
    const raw = getSetting(`${PREFIX}${name}`);
    if (!raw) return NextResponse.json({ error: "Snapshot introuvable" }, { status: 404 });
    let parsed: any;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return NextResponse.json({ error: "Snapshot corrompu" }, { status: 500 });
    }
    const check = ProfileFullSchema.safeParse(parsed.profile);
    if (!check.success) {
      return NextResponse.json({ error: "Snapshot invalide", details: check.error.flatten() }, { status: 500 });
    }
    saveProfile(check.data);

    // Re-score immédiat de toutes les offres avec le profil chargé (local, gratuit)
    const loaded = getProfile()!;
    let rescored = 0;
    for (const o of listOffres()) {
      setOffreScore(
        o.id,
        scoreOffreLocal(loaded, {
          title: o.title,
          company: o.company,
          country: o.country,
          description_text: o.description_text,
          contract_type: o.contract_type,
        })
      );
      rescored++;
    }
    return NextResponse.json({ ok: true, loaded: name, rescored });
  }

  if (action === "delete") {
    getDb().prepare("DELETE FROM settings WHERE key = ?").run(`${PREFIX}${name}`);
    return NextResponse.json({ ok: true, deleted: name });
  }

  return NextResponse.json({ error: "Action inconnue" }, { status: 400 });
}
