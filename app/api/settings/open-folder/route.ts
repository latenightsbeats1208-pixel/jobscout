import { NextRequest, NextResponse } from "next/server";
import { spawn } from "node:child_process";
import { getSetting } from "@/lib/db";
import { documentsDir } from "@/lib/paths";
import fs from "node:fs";
import { isServerMode } from "@/lib/server-mode";

export const runtime = "nodejs";

/**
 * Opens the documents folder in the user's OS file explorer.
 * Only meaningful when running locally (npm run dev).
 */
export async function POST(req: NextRequest) {
  // Serveur distant : aucun explorateur de fichiers à ouvrir (et xdg-open absent du conteneur).
  if (isServerMode()) return NextResponse.json({ ok: false, opened: null });
  const body = await req.json().catch(() => ({}));
  // Sécurité : on n'ouvre QUE le dossier documents configuré, jamais un chemin
  // arbitraire fourni par le client (body.path est ignoré).
  const target: string = getSetting("documents_folder") || documentsDir();

  if (!fs.existsSync(target)) {
    try {
      fs.mkdirSync(target, { recursive: true });
    } catch {
      return NextResponse.json({ error: "Dossier introuvable" }, { status: 404 });
    }
  }

  try {
    const platform = process.platform;
    if (platform === "win32") {
      spawn("explorer.exe", [target], { detached: true, stdio: "ignore" }).on("error", () => {}).unref();
    } else if (platform === "darwin") {
      spawn("open", [target], { detached: true, stdio: "ignore" }).on("error", () => {}).unref();
    } else {
      spawn("xdg-open", [target], { detached: true, stdio: "ignore" }).on("error", () => {}).unref();
    }
    return NextResponse.json({ ok: true, opened: target });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
