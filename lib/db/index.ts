import "server-only";
import { DatabaseSync } from "node:sqlite";
import { dbPath } from "@/lib/paths";
import { openDatabase } from "@/lib/db/migrations";

const DB_PATH = dbPath();

let _db: DatabaseSync | null = null;

export function getDb(): DatabaseSync {
  if (_db) return _db;
  // Crée la base ou l'amène à la dernière version du schéma (voir migrations.ts).
  _db = openDatabase(DB_PATH);
  return _db;
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
