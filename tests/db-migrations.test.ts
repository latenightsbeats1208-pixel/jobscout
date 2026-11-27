import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { LATEST_VERSION, MIGRATIONS, openDatabase, type Migration } from "@/lib/db/migrations";

const SCHEMA = fs.readFileSync(path.join(__dirname, "..", "lib", "db", "schema.sql"), "utf-8");

// Base « d'avant les migrations » (user_version = 0), FIGÉE dans un fichier à part :
// si elle était dérivée de schema.sql, une colonne ajoutée à schema.sql sans migration
// y apparaîtrait aussi et le test « même structure qu'une base neuve » ne verrait rien.
const SCHEMA_ANCIEN = fs.readFileSync(path.join(__dirname, "schema-v0.sql"), "utf-8");

const dirs: string[] = [];
function tmpDb(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jobscout-migr-"));
  dirs.push(dir);
  return path.join(dir, "jobscout.db");
}
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function creerBaseAncienne(file: string): void {
  const db = new DatabaseSync(file);
  db.exec(SCHEMA_ANCIEN);
  db.prepare("INSERT INTO profile (full_name, email) VALUES (?, ?)").run("Ada Lovelace", "ada@example.org");
  db.close();
}

function colonnes(db: DatabaseSync, table: string): string[] {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name).sort();
}

function versionDe(db: DatabaseSync): number {
  return (db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;
}

function structure(db: DatabaseSync): Record<string, string[]> {
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all() as { name: string }[];
  return Object.fromEntries(tables.map((t) => [t.name, colonnes(db, t.name)]));
}

describe("migrations de la base", () => {
  it("le schéma de test « ancien » n'a bien pas la colonne (garde du test lui-même)", () => {
    expect(SCHEMA_ANCIEN).not.toMatch(/^\s*preferred_contracts\s/m);
  });

  it("les versions des migrations se suivent à partir de 1", () => {
    MIGRATIONS.forEach((m, i) => expect(m.version).toBe(i + 1));
    expect(LATEST_VERSION).toBe(MIGRATIONS.length);
  });

  it("une base neuve est créée directement à la dernière version", () => {
    const db = openDatabase(tmpDb());
    expect(versionDe(db)).toBe(LATEST_VERSION);
    expect(colonnes(db, "profile")).toContain("preferred_contracts");
    db.close();
  });

  it("une base ancienne est mise à jour sans perdre ses données", () => {
    const file = tmpDb();
    creerBaseAncienne(file);

    const db = openDatabase(file);
    expect(versionDe(db)).toBe(LATEST_VERSION);
    const row = db.prepare("SELECT full_name, preferred_contracts FROM profile").get() as {
      full_name: string;
      preferred_contracts: string;
    };
    expect(row.full_name).toBe("Ada Lovelace");
    expect(JSON.parse(row.preferred_contracts)).toEqual(["cdi", "cdd"]);
    db.close();
  });

  it("une base mise à jour a exactement la même structure qu'une base neuve", () => {
    const ancienne = tmpDb();
    creerBaseAncienne(ancienne);
    const migree = openDatabase(ancienne);
    const neuve = openDatabase(tmpDb());
    expect(structure(migree)).toEqual(structure(neuve));
    migree.close();
    neuve.close();
  });

  it("une base de la version actuelle sans numéro de version (user_version = 0) est reconnue sans erreur", () => {
    const file = tmpDb();
    const brute = new DatabaseSync(file);
    brute.exec(SCHEMA); // structure à jour, mais jamais numérotée
    brute.close();

    const db = openDatabase(file);
    expect(versionDe(db)).toBe(LATEST_VERSION);
    db.close();
  });

  it("rouvrir une base à jour ne rejoue aucune migration et ne crée pas de sauvegarde", () => {
    const file = tmpDb();
    openDatabase(file).close();
    const db = openDatabase(file);
    expect(versionDe(db)).toBe(LATEST_VERSION);
    db.close();
    expect(fs.readdirSync(path.dirname(file)).filter((f) => f.includes("avant-migration"))).toEqual([]);
  });

  it("sauvegarde la base avant de la migrer", () => {
    const file = tmpDb();
    creerBaseAncienne(file);
    openDatabase(file).close();

    const backup = path.join(path.dirname(file), "jobscout.avant-migration-v0.db");
    expect(fs.existsSync(backup)).toBe(true);
    const copie = new DatabaseSync(backup, { readOnly: true });
    expect(versionDe(copie)).toBe(0);
    expect(colonnes(copie, "profile")).not.toContain("preferred_contracts");
    expect((copie.prepare("SELECT full_name FROM profile").get() as { full_name: string }).full_name).toBe(
      "Ada Lovelace"
    );
    copie.close();
  });

  it("une migration qui échoue est annulée entièrement et l'erreur remonte (jamais avalée)", () => {
    const file = tmpDb();
    creerBaseAncienne(file);

    const enPanne: Migration[] = [
      ...MIGRATIONS,
      {
        version: LATEST_VERSION + 1,
        description: "migration volontairement cassée",
        up(db) {
          db.exec("ALTER TABLE profile ADD COLUMN a_moitie TEXT");
          db.exec("ALTER TABLE table_inexistante ADD COLUMN x TEXT");
        },
      },
    ];

    expect(() => openDatabase(file, enPanne)).toThrow(/migration volontairement cassée/);

    // Les migrations précédentes, réussies, restent acquises ; la migration
    // cassée n'a rien laissé derrière elle.
    const db = new DatabaseSync(file);
    expect(versionDe(db)).toBe(LATEST_VERSION);
    expect(colonnes(db, "profile")).toContain("preferred_contracts");
    expect(colonnes(db, "profile")).not.toContain("a_moitie");
    db.close();
  });

  it("refuse d'ouvrir une base créée par une version plus récente de JobScout", () => {
    const file = tmpDb();
    const db = new DatabaseSync(file);
    db.exec(SCHEMA);
    db.exec(`PRAGMA user_version = ${LATEST_VERSION + 5}`);
    db.close();

    expect(() => openDatabase(file)).toThrow(/plus récente/);
  });
});
