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
  repairLegacyTalentRows(db);

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
