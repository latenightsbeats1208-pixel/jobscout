import "server-only";
import fs from "node:fs";
import path from "node:path";
import { getSetting, setSetting } from "@/lib/db";
import { userDataDir } from "@/lib/paths";
import { parseCvTemplate, type CvTemplate } from "./types";

const SETTING_KEY = "cv_template";
const DELETED = "none";
/** Fichier déposé dans le dossier de données (volume Docker) : importé au premier accès s'il n'y a pas encore de modèle. */
export const TEMPLATE_SEED_FILE = "cv-template.json";

export function seedFilePath(): string {
  return path.join(userDataDir(), TEMPLATE_SEED_FILE);
}

/** Modèle enregistré, ou null. Un modèle stocké devenu invalide est ignoré (et signalé dans le journal). */
export function getCvTemplate(): CvTemplate | null {
  const raw = getSetting(SETTING_KEY);
  // Supprimé volontairement : le fichier de départ n'est pas réimporté.
  if (raw === DELETED) return null;
  if (raw) {
    try {
      const parsed = parseCvTemplate(JSON.parse(raw));
      if (parsed.ok) return parsed.template;
      console.log(`[cv-template] modèle enregistré invalide : ${parsed.errors.join(" ; ")}`);
    } catch {
      console.log("[cv-template] modèle enregistré illisible (JSON)");
    }
    return null;
  }
  return importSeedFile();
}

function importSeedFile(): CvTemplate | null {
  const file = seedFilePath();
  if (!fs.existsSync(file)) return null;
  try {
    const parsed = parseCvTemplate(JSON.parse(fs.readFileSync(file, "utf-8")));
    if (!parsed.ok) {
      console.log(`[cv-template] ${file} invalide : ${parsed.errors.join(" ; ")}`);
      return null;
    }
    setSetting(SETTING_KEY, JSON.stringify(parsed.template));
    console.log(`[cv-template] modèle importé depuis ${file}`);
    return parsed.template;
  } catch (e) {
    console.log(`[cv-template] lecture de ${file} impossible : ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}

export function saveCvTemplate(raw: unknown): { ok: true; template: CvTemplate } | { ok: false; errors: string[] } {
  const parsed = parseCvTemplate(raw);
  if (parsed.ok) setSetting(SETTING_KEY, JSON.stringify(parsed.template));
  return parsed;
}

/** Supprime le modèle : la génération revient au CV rédigé par l'IA depuis le profil. */
export function deleteCvTemplate(): void {
  setSetting(SETTING_KEY, DELETED);
}
