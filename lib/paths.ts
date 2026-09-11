import "server-only";
import fs from "node:fs";
import path from "node:path";

/**
 * Résolution centralisée des emplacements de données utilisateur.
 *
 * En développement, tout vit dans `<projet>/data`.
 * En version installée, le launcher pose `JOBSCOUT_DATA_DIR` sur
 * `%LOCALAPPDATA%\JobScout` : le répertoire d'installation reste en lecture
 * seule et aucune donnée personnelle ne s'écrit à côté du binaire.
 */
export function userDataDir(): string {
  const explicit = process.env.JOBSCOUT_DATA_DIR?.trim();
  if (explicit) return path.resolve(explicit);
  return path.join(process.cwd(), "data");
}

export function dbPath(): string {
  const explicit = process.env.JOBSCOUT_DB_PATH?.trim();
  if (explicit) return path.resolve(explicit);
  return path.join(userDataDir(), "jobscout.db");
}

export function documentsDir(): string {
  const explicit = process.env.JOBSCOUT_DOCS_PATH?.trim();
  if (explicit) return path.resolve(explicit);
  return path.join(userDataDir(), "documents");
}

/** Navigateurs Playwright (moteur LinkedIn) — téléchargés à la demande. */
export function browsersDir(): string {
  const explicit = process.env.PLAYWRIGHT_BROWSERS_PATH?.trim();
  if (explicit) return path.resolve(explicit);
  return path.join(userDataDir(), "browsers");
}

export function ensureDir(dir: string): string {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Racines dans lesquelles l'utilisateur a le droit de placer son dossier de
 * documents. On autorise son répertoire personnel et la racine de données de
 * l'application (les deux lui appartiennent), jamais un chemin système.
 */
export function writableRoots(): string[] {
  const roots = [userDataDir()];
  const home = process.env.USERPROFILE || process.env.HOME;
  if (home) roots.push(home);
  return roots.map((r) => path.resolve(r));
}
