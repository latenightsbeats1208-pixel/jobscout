import "server-only";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

/**
 * Migrations versionnées de la base SQLite.
 *
 * La version du schéma est rangée dans l'en-tête du fichier (`PRAGMA user_version`).
 * - Base neuve : `schema.sql` la crée directement dans sa forme la plus récente,
 *   puis elle est numérotée à la dernière version.
 * - Base existante : chaque migration qui lui manque est appliquée dans l'ordre, chacune
 *   dans sa propre transaction (elle passe entièrement ou pas du tout), après une copie
 *   de sauvegarde de la base. Une erreur n'est jamais avalée : l'application s'arrête
 *   avec un message qui dit quelle migration a échoué et où est la sauvegarde.
 *
 * Changer la structure d'une table existante :
 * 1. modifier `schema.sql` (forme des bases neuves) ;
 * 2. ajouter ici une migration au numéro suivant, qui amène une base existante à la même
 *    forme (le test « même structure qu'une base neuve » vérifie que les deux concordent).
 * Une nouvelle table ou un nouvel index (`CREATE … IF NOT EXISTS`) n'ont besoin que de
 * `schema.sql`, rejoué à chaque ouverture après les migrations.
 *
 * Une migration ne doit jamais être modifiée une fois publiée : les bases déjà migrées
 * ne la rejoueraient pas. Pour reconstruire une table (SQLite ne sait pas tout faire
 * avec ALTER TABLE), couper `foreign_keys` avant la transaction.
 */

export type Migration = {
  /** 1, 2, 3… sans trou : la base est à la version de la dernière migration appliquée. */
  version: number;
  /** Phrase lisible, reprise dans le message d'erreur si la migration échoue. */
  description: string;
  up(db: DatabaseSync): void;
};

function hasColumn(db: DatabaseSync, table: string, column: string): boolean {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return cols.some((c) => c.name === column);
}

function hasTable(db: DatabaseSync, table: string): boolean {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
}

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    description: "profil : contrats recherchés (preferred_contracts)",
    up(db) {
      // Les bases d'avant la numérotation ont déjà cette colonne ou non.
      if (!hasColumn(db, "profile", "preferred_contracts")) {
        db.exec(`ALTER TABLE profile ADD COLUMN preferred_contracts TEXT NOT NULL DEFAULT '["cdi","cdd"]'`);
      }
    },
  },
];

export const LATEST_VERSION = MIGRATIONS.length;

function readSchema(): string {
  return fs.readFileSync(path.join(process.cwd(), "lib", "db", "schema.sql"), "utf-8");
}

function userVersion(db: DatabaseSync): number {
  return (db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;
}

function backupPath(file: string, version: number): string {
  const { dir, name } = path.parse(file);
  return path.join(dir, `${name}.avant-migration-v${version}.db`);
}

/**
 * Copie cohérente de la base (y compris ce qui est encore dans le journal WAL).
 * Une copie déjà présente pour cette version est gardée : c'est la plus ancienne,
 * donc la plus sûre si une tentative précédente a échoué.
 */
function backup(db: DatabaseSync, file: string, version: number): string {
  const target = backupPath(file, version);
  if (!fs.existsSync(target)) db.exec(`VACUUM INTO '${target.replaceAll("'", "''")}'`);
  return target;
}

/**
 * Ouvre (ou crée) la base et l'amène à la dernière version du schéma.
 * `migrations` n'est à fournir que par les tests.
 */
export function openDatabase(file: string, migrations: Migration[] = MIGRATIONS): DatabaseSync {
  const latest = migrations.length ? migrations[migrations.length - 1].version : 0;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  try {
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA foreign_keys = ON");

    if (!hasTable(db, "profile")) {
      db.exec(readSchema());
      db.exec(`PRAGMA user_version = ${latest}`);
      return db;
    }

    const from = userVersion(db);
    if (from > latest) {
      throw new Error(
        `Cette base de données vient d'une version plus récente de JobScout (schéma v${from}, ` +
          `cette version connaît jusqu'à v${latest}). Elle n'a pas été modifiée : mettez JobScout à jour.`
      );
    }

    const pending = migrations.filter((m) => m.version > from);
    if (pending.length) {
      const copy = backup(db, file, from);
      let current = from;
      for (const m of pending) {
        db.exec("BEGIN");
        try {
          m.up(db);
          db.exec(`PRAGMA user_version = ${m.version}`);
          db.exec("COMMIT");
        } catch (e) {
          db.exec("ROLLBACK");
          const reason = e instanceof Error ? e.message : String(e);
          throw new Error(
            `Mise à jour de la base impossible (migration ${m.version} : ${m.description}) : ${reason}. ` +
              `La base est restée à la version ${current} ; copie d'avant la mise à jour : ${copy}`,
            { cause: e }
          );
        }
        current = m.version;
      }
    }

    // Nouvelles tables et nouveaux index (CREATE … IF NOT EXISTS), après les migrations
    // pour qu'un index puisse viser une colonne qu'une migration vient d'ajouter.
    db.exec(readSchema());
    return db;
  } catch (e) {
    db.close();
    throw e;
  }
}
