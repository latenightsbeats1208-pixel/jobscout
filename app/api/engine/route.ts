import { NextResponse } from "next/server";
import {
  getEngineState,
  startEngineInstall,
  ENGINE_LABEL,
  ENGINE_SIZE_LABEL,
  ENGINE_DISK_SIZE_LABEL,
} from "@/lib/scrapers/browser-engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** État du moteur de navigation optionnel (Chromium, requis par LinkedIn). */
export async function GET() {
  return NextResponse.json({
    ...getEngineState(),
    label: ENGINE_LABEL,
    size: ENGINE_SIZE_LABEL,
    diskSize: ENGINE_DISK_SIZE_LABEL,
  });
}

/** Démarre le téléchargement du moteur. Non bloquant : l'UI interroge GET. */
export async function POST() {
  const res = startEngineInstall();
  return NextResponse.json({ ...res, ...getEngineState() });
}
