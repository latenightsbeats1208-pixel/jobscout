import "server-only";
import { getDb, getSetting, plain, plainAll } from "./index";
import { documentsDir } from "@/lib/paths";
import fs from "node:fs";
import { AiContentError } from "@/lib/ai/errors";
import path from "node:path";

const TYPE_LABEL: Record<string, string> = { cv: "CV", lm: "LM", msg: "MSG" };

/**
 * Strip filesystem-illegal characters but preserve spaces and accents
 * (Windows accepts both, modern OS too). Caps length per part.
 */
function safeFilenamePart(s: string | null | undefined, maxLen = 60): string {
  if (!s) return "";
  return s
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "")
    .replace(/\s+/g, " ")
    .slice(0, maxLen)
    .trim();
}

/**
 * Build a recruiter-friendly filename: "CV - Nom Prénom - Titre du poste.ext"
 */
export function buildDocFilename(args: {
  type: string;
  format: string;
  fullName: string | null | undefined;
  title: string | null | undefined;
}): string {
  const label = TYPE_LABEL[args.type] ?? args.type.toUpperCase();
  const parts = [label];
  const name = safeFilenamePart(args.fullName, 40);
  if (name) parts.push(name);
  const title = safeFilenamePart(args.title, 60);
  if (title) parts.push(title);
  return `${parts.join(" - ")}.${args.format}`;
}

/** Returns the user-configured documents folder (settings table) or the default one. */
function docsRootResolved(): string {
  const userFolder = getSetting("documents_folder");
  if (userFolder && userFolder.trim().length > 0) return userFolder;
  return documentsDir();
}

export type DocType = "cv" | "lm" | "msg";

export type DocumentRow = {
  id: number;
  type: DocType;
  offre_id: number | null;
  file_path: string;
  format: string;
  generated_at: string;
};

/** Slugify a string for safe folder/file names: ASCII only, dashes, lowercase, capped length. */
export function slugify(input: string, maxLen = 40): string {
  return input
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLen)
    .replace(/-+$/, "");
}

/**
 * Folder structure (all generated docs are grouped per offer):
 *   data/documents/{offre_id}-{company}-{title}/cv.pdf
 *                                              /cv.docx
 *                                              /lm.pdf
 *                                              /lm.docx
 *                                              /msg.txt
 *
 * Imported/manual docs (no offre_id) live in:  data/documents/_unattached/<type>-<timestamp>.<ext>
 */
export function offreFolderPath(offreId: number, company: string, title: string): string {
  const slug = `${offreId}-${slugify(company)}-${slugify(title, 30)}`.replace(/-+$/, "");
  return path.join(docsRootResolved(), slug);
}

export function saveDocument(args: {
  type: DocType;
  offreId: number | null;
  format: "pdf" | "docx" | "txt";
  buffer: Buffer | string;
  /** Optional: company + title used to build a human-readable folder per offer */
  meta?: { company: string; title: string };
}): DocumentRow {
  let dir: string;
  let filename: string;

  if (args.offreId && args.meta) {
    dir = offreFolderPath(args.offreId, args.meta.company, args.meta.title);

    // Build human-readable filename ("CV - Prénom NOM - Intitulé.docx")
    const profileRow = getDb()
      .prepare("SELECT full_name FROM profile ORDER BY id ASC LIMIT 1")
      .get() as { full_name: string | null } | undefined;
    const fullName = profileRow?.full_name ?? null;
    filename = buildDocFilename({
      type: args.type,
      format: args.format,
      fullName,
      title: args.meta.title,
    });

    // Cleanup: remove any previously-generated file of the SAME type+format in this folder
    // (covers both the new naming convention AND legacy "cv.docx" / "lm.pdf" files).
    if (fs.existsSync(dir)) {
      const label = TYPE_LABEL[args.type] ?? args.type.toUpperCase();
      const ext = `.${args.format}`;
      for (const f of fs.readdirSync(dir)) {
        if (
          f === `${args.type}${ext}` || // legacy "cv.docx"
          (f.startsWith(`${label} - `) && f.endsWith(ext)) // new convention "CV - ... .docx"
        ) {
          try {
            fs.unlinkSync(path.join(dir, f));
          } catch {}
        }
      }
    }
  } else {
    dir = path.join(docsRootResolved(), "_unattached");
    filename = `${args.type}-${Date.now()}.${args.format}`;
  }

  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, filename);
  try {
    if (typeof args.buffer === "string") fs.writeFileSync(filePath, args.buffer, "utf-8");
    else fs.writeFileSync(filePath, args.buffer);
  } catch (e) {
    const code = (e as NodeJS.ErrnoException)?.code;
    if (code === "EBUSY" || code === "EPERM" || code === "EACCES") {
      // Cas réel : le document précédent est encore ouvert dans Word/Acrobat.
      throw new AiContentError(
        `Le fichier « ${path.basename(filePath)} » est ouvert dans une autre application (Word, Acrobat…) — fermez-le puis relancez la génération.`,
        409
      );
    }
    throw e;
  }

  const db = getDb();
  // De-duplicate: if a row already exists for this exact (offre_id, type, format), update its path
  // and bump generated_at so the latest is unambiguous. Otherwise insert a new row.
  let id: number;
  if (args.offreId) {
    const existing = db
      .prepare(
        "SELECT id FROM documents WHERE offre_id = ? AND type = ? AND format = ? LIMIT 1"
      )
      .get(args.offreId, args.type, args.format) as { id: number } | undefined;
    if (existing) {
      db.prepare(
        "UPDATE documents SET file_path = ?, generated_at = datetime('now') WHERE id = ?"
      ).run(filePath, existing.id);
      id = existing.id;
    } else {
      const res = db
        .prepare("INSERT INTO documents (type, offre_id, file_path, format) VALUES (?, ?, ?, ?)")
        .run(args.type, args.offreId, filePath, args.format);
      id = Number(res.lastInsertRowid);
    }
  } else {
    const res = db
      .prepare("INSERT INTO documents (type, offre_id, file_path, format) VALUES (?, ?, ?, ?)")
      .run(args.type, args.offreId, filePath, args.format);
    id = Number(res.lastInsertRowid);
  }

  return {
    id,
    type: args.type,
    offre_id: args.offreId,
    file_path: filePath,
    format: args.format,
    generated_at: new Date().toISOString(),
  };
}

export function listDocuments(filter?: { type?: DocType; offreId?: number }): DocumentRow[] {
  const db = getDb();
  const where: string[] = [];
  const params: any[] = [];
  if (filter?.type) {
    where.push("type = ?");
    params.push(filter.type);
  }
  if (filter?.offreId != null) {
    where.push("offre_id = ?");
    params.push(filter.offreId);
  }
  const sql = `SELECT * FROM documents ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY generated_at DESC`;
  return plainAll(db.prepare(sql).all(...params) as DocumentRow[]);
}

export function getDocument(id: number): DocumentRow | null {
  const r = getDb().prepare("SELECT * FROM documents WHERE id = ?").get(id) as
    | DocumentRow
    | undefined;
  return r ? plain(r) : null;
}

export function getLatestDoc(offreId: number, type: DocType): DocumentRow | null {
  const r = getDb()
    .prepare(
      "SELECT * FROM documents WHERE offre_id = ? AND type = ? ORDER BY generated_at DESC LIMIT 1"
    )
    .get(offreId, type) as DocumentRow | undefined;
  return r ? plain(r) : null;
}

/** Path to the root documents folder (user-configured or default), useful to display in the UI. */
export function documentsRoot(): string {
  return docsRootResolved();
}
