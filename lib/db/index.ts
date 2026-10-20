import "server-only";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { dbPath } from "@/lib/paths";

const DB_PATH = dbPath();

let _db: DatabaseSync | null = null;

export function getDb(): DatabaseSync {
  if (_db) return _db;
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const db = new DatabaseSync(DB_PATH);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");

  const schemaPath = path.join(process.cwd(), "lib", "db", "schema.sql");
  const schema = fs.readFileSync(schemaPath, "utf-8");
  db.exec(schema);

  // Migrations additives (bases existantes) — no-op si la colonne existe déjà.
  try {
    db.exec(
      `ALTER TABLE profile ADD COLUMN preferred_contracts TEXT NOT NULL DEFAULT '["cdi","cdd"]'`
    );
  } catch {}
  try {
    db.exec(`ALTER TABLE profile ADD COLUMN target_titles TEXT NOT NULL DEFAULT '[]'`);
  } catch {}
  try {
    db.exec(`ALTER TABLE offres ADD COLUMN ai_review TEXT`);
  } catch {}
  try {
    db.exec(`ALTER TABLE profile ADD COLUMN search_area TEXT NOT NULL DEFAULT ''`);
  } catch {}
  try {
    db.exec(`ALTER TABLE offres ADD COLUMN quality_issues TEXT`);
  } catch {}
  for (const column of ["first_seen_at TEXT", "closed_at TEXT", "checked_at TEXT", "duplicate_of INTEGER"]) {
    try {
      db.exec(`ALTER TABLE offres ADD COLUMN ${column}`);
    } catch {}
  }
  try {
    db.exec(`ALTER TABLE scan_runs ADD COLUMN summary TEXT`);
  } catch {}
  try {
    db.exec(`ALTER TABLE profile ADD COLUMN remote TEXT NOT NULL DEFAULT ''`);
  } catch {}
  // Offres collectées avant la colonne : leur dernière collecte, faute de mieux.
  db.exec("UPDATE offres SET first_seen_at = scraped_at WHERE first_seen_at IS NULL");
  repairLegacyTalentRows(db);
  repairFranceTravailCompanies(db);

  _db = db;
  return db;
}

export function transaction<T>(fn: () => T): T {
  const db = getDb();
  db.exec("BEGIN");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

// ----------- Settings helpers -----------
export function getSetting(key: string): string | null {
  const row = getDb().prepare("SELECT value FROM settings WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

export function setSetting(key: string, value: string): void {
  getDb()
    .prepare(
      "INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
    )
    .run(key, value);
}

// ----------- JSON column helpers -----------
export function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function asJson(value: unknown): string {
  return JSON.stringify(value ?? null);
}

// node:sqlite returns rows with a null prototype, which React Server Components
// refuse to serialize to Client Components. Re-create as plain objects.
export function plain<T>(row: T): T {
  if (row == null) return row;
  return { ...(row as object) } as T;
}
export function plainAll<T>(rows: T[]): T[] {
  return rows.map((r) => plain(r));
}

/**
 * Réparation unique des offres Talent.com lues par l'ancien analyseur de cartes
 * (jusqu'en octobre 2026) : il rangeait le nom de l'entreprise dans le contrat
 * et ne trouvait jamais le lieu. Le « contrat » devient l'entreprise quand
 * celle-ci manque, puis il est vidé. Le lieu reste vide : seule une nouvelle
 * collecte le rend. Les lignes concernées se reconnaissent à leur lieu vide —
 * et la réparation ne tourne qu'une fois, avant toute collecte par le nouvel
 * analyseur.
 */
export function repairLegacyTalentRows(db: DatabaseSync): void {
  const FLAG = "repair:talent-cards-2026-10";
  if (db.prepare("SELECT 1 FROM settings WHERE key = ?").get(FLAG)) return;
  db.exec(`
    UPDATE offres
    SET company = CASE WHEN company IS NULL OR company = '' THEN contract_type ELSE company END,
        contract_type = NULL
    WHERE source = 'talent' AND (location IS NULL OR location = '') AND contract_type IS NOT NULL
  `);
  db.prepare("INSERT INTO settings(key, value) VALUES(?, ?)").run(FLAG, new Date().toISOString());
}

/**
 * Réparation unique des offres France Travail anonymes : l'analyseur prenait le
 * département de la ligne « 26 - Romans-sur-Isère » pour le nom de l'entreprise.
 */
export function repairFranceTravailCompanies(db: DatabaseSync): void {
  const FLAG = "repair:ft-company-departement-2026-10";
  if (db.prepare("SELECT 1 FROM settings WHERE key = ?").get(FLAG)) return;
  db.exec(`
    UPDATE offres SET company = ''
    WHERE source = 'francetravail'
      AND (company GLOB '[0-9][0-9]' OR company GLOB '[0-9][0-9][0-9]' OR upper(company) IN ('2A', '2B'))
  `);
  db.prepare("INSERT INTO settings(key, value) VALUES(?, ?)").run(FLAG, new Date().toISOString());
}

/**
 * Empreinte de la base, lue à chaque appel (deux lectures de quelques microsecondes) :
 * - `PRAGMA data_version` change dès qu'une AUTRE connexion valide une écriture
 *   (autre instance du module, script de scan quotidien, autre processus) ;
 * - `total_changes()` compte les lignes écrites par CETTE connexion (scan, re-score,
 *   documents générés, suppressions…), y compris les écritures sans date comme le re-score.
 * Toute écriture la change donc ; aucune ne peut laisser périmé ce qui en dépend.
 */
export function dbFingerprint(): string {
  const db = getDb();
  const version = (db.prepare("PRAGMA data_version").get() as { data_version: number }).data_version;
  const changes = (db.prepare("SELECT total_changes() AS n").get() as { n: number }).n;
  return `${version}:${changes}`;
}
