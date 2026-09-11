import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { getSetting, setSetting } from "@/lib/db";
import { documentsDir, writableRoots } from "@/lib/paths";

export const runtime = "nodejs";

const SETTING_KEY = "documents_folder";

function defaultPath() {
  return documentsDir();
}

// Le dossier des documents doit rester sous le répertoire personnel de
// l'utilisateur ou sous la racine de données de l'application — empêche
// d'écrire des fichiers dans des emplacements système arbitraires.
function isAllowedPath(target: string): boolean {
  const resolved = path.resolve(target);
  const roots = writableRoots();
  return roots.some((root) => {
    const rel = path.relative(root, resolved);
    return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
  });
}

export async function GET() {
  const stored = getSetting(SETTING_KEY);
  return NextResponse.json({
    folder: stored ?? defaultPath(),
    isCustom: !!stored,
    defaultFolder: defaultPath(),
  });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const action = body.action ?? "save";
  const rawFolder: string | undefined = body.folder;

  if (action === "reset") {
    setSetting(SETTING_KEY, "");
    return NextResponse.json({ ok: true, folder: defaultPath(), isCustom: false });
  }

  if (!rawFolder || typeof rawFolder !== "string") {
    return NextResponse.json({ error: "Chemin manquant" }, { status: 400 });
  }
  const folder = path.resolve(rawFolder.trim());

  if (!isAllowedPath(folder)) {
    return NextResponse.json(
      { error: "Chemin non autorisé : choisissez un dossier dans votre répertoire utilisateur." },
      { status: 400 }
    );
  }

  // Try to create it if doesn't exist
  try {
    fs.mkdirSync(folder, { recursive: true });
  } catch (e) {
    return NextResponse.json(
      {
        error: `Impossible de créer le dossier : ${e instanceof Error ? e.message : String(e)}`,
      },
      { status: 400 }
    );
  }

  // Test write access by writing a tiny probe file
  const probe = path.join(folder, ".jobscout-write-test");
  try {
    fs.writeFileSync(probe, "ok");
    fs.unlinkSync(probe);
  } catch (e) {
    return NextResponse.json(
      {
        error: `Le dossier existe mais n'est pas accessible en écriture : ${
          e instanceof Error ? e.message : String(e)
        }`,
      },
      { status: 400 }
    );
  }

  if (action === "verify") {
    return NextResponse.json({ ok: true, folder, writable: true });
  }

  setSetting(SETTING_KEY, folder);
  return NextResponse.json({ ok: true, folder, isCustom: true });
}
