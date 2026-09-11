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
