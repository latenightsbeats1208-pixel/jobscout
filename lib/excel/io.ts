import "server-only";
import * as XLSX from "xlsx";
import { STATUS, type CandidatureWithOffre, type Status } from "@/lib/db/candidatures";

const COLUMNS = [
  "Date",
  "Entreprise",
  "Poste",
  "Pays",
  "Score",
  "Deadline",
  "Statut",
  "Notes",
  "Contact",
  "URL",
];

export function candidaturesToXlsx(rows: CandidatureWithOffre[]): Buffer {
  const data = rows.map((r) => ({
    Date: r.applied_at?.split(" ")[0] ?? "",
    Entreprise: r.offre_company ?? r.ext_company ?? "",
    Poste: r.offre_title ?? r.ext_title ?? "",
    Pays: r.offre_country ?? r.ext_country ?? "",
    Score: r.offre_score ?? r.ext_score ?? "",
    Deadline: r.deadline ?? "",
    Statut: r.status,
    Notes: r.notes ?? "",
    Contact: r.contact ?? "",
    URL: r.offre_url ?? r.ext_url ?? "",
  }));
  const ws = XLSX.utils.json_to_sheet(data, { header: COLUMNS });
  // column widths
  ws["!cols"] = [
    { wch: 12 },
    { wch: 24 },
    { wch: 36 },
    { wch: 14 },
    { wch: 8 },
    { wch: 12 },
    { wch: 12 },
    { wch: 36 },
    { wch: 24 },
    { wch: 40 },
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Candidatures");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  return buf;
}

/**
 * Ramène le libellé de statut du fichier importé vers la liste autorisée.
 * Tolère les variantes de casse/accents/espaces ("Envoyée", "En cours") issues d'une
 * édition manuelle dans Excel ; toute valeur inconnue retombe sur "envoyee",
 * le même défaut que celui appliqué aux lignes sans colonne Statut.
 */
function coerceStatus(raw: string): Status {
  const v = raw
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim()
    .replace(/\s+/g, "_");
  return STATUS.find((s) => s === v) ?? "envoyee";
}

export function xlsxToCandidatures(buffer: Buffer): {
  applied_at: string | null;
  ext_company: string | null;
  ext_title: string | null;
  ext_country: string | null;
  ext_score: number | null;
  deadline: string | null;
  status: Status;
  notes: string | null;
  contact: string | null;
  ext_url: string | null;
}[] {
  const wb = XLSX.read(buffer, { type: "buffer" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows: any[] = XLSX.utils.sheet_to_json(ws, { defval: "" });

  const norm = (s: string) => s.toString().toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "").trim();
  const findKey = (row: any, candidates: string[]): string | undefined => {
    const keys = Object.keys(row);
    for (const c of candidates) {
      const k = keys.find((k) => norm(k).includes(norm(c)));
      if (k) return k;
    }
    return undefined;
  };

  return rows.map((r) => {
    const k = (cands: string[]) => findKey(r, cands);
    const dateK = k(["date"]);
    const compK = k(["entreprise", "company"]);
    const postK = k(["poste", "titre", "title", "job"]);
    const paysK = k(["pays", "country"]);
    const scoreK = k(["score"]);
    const dlK = k(["deadline", "echeance"]);
    const statK = k(["statut", "status"]);
    const notesK = k(["notes", "note"]);
    const contactK = k(["contact"]);
    const urlK = k(["url", "lien", "link"]);

    return {
      applied_at: dateK ? String(r[dateK]) || null : null,
      ext_company: compK ? String(r[compK]) || null : null,
      ext_title: postK ? String(r[postK]) || null : null,
      ext_country: paysK ? String(r[paysK]) || null : null,
      ext_score: scoreK && r[scoreK] !== "" ? Number(r[scoreK]) : null,
      deadline: dlK ? String(r[dlK]) || null : null,
      status: statK ? coerceStatus(String(r[statK])) : "envoyee",
      notes: notesK ? String(r[notesK]) || null : null,
      contact: contactK ? String(r[contactK]) || null : null,
      ext_url: urlK ? String(r[urlK]) || null : null,
    };
  });
}
