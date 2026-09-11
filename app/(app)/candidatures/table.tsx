"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Download, Upload, Trash2, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { CandidatureWithOffre } from "@/lib/db/candidatures";

const STATUS_OPTIONS = [
  { id: "envoyee", label: "Envoyée", variant: "default" as const },
  { id: "en_cours", label: "En cours", variant: "info" as const },
  { id: "entretien", label: "Entretien", variant: "warning" as const },
  { id: "acceptee", label: "Acceptée", variant: "success" as const },
  { id: "refusee", label: "Refusée", variant: "danger" as const },
];

export function CandidaturesTable({ initial }: { initial: CandidatureWithOffre[] }) {
  const [rows, setRows] = useState(initial);
  const [filter, setFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const router = useRouter();

  const filtered = rows.filter((r) => {
    if (statusFilter && r.status !== statusFilter) return false;
    if (filter) {
      const q = filter.toLowerCase();
      const hay = [r.offre_company, r.offre_title, r.ext_company, r.ext_title, r.notes, r.contact]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  async function patch(id: number, body: any) {
    const res = await fetch("/api/candidatures", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, ...body }),
    });
    if (res.ok) setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...body } : r)));
  }

  async function remove(id: number) {
    if (!confirm("Supprimer cette candidature ?")) return;
    const res = await fetch(`/api/candidatures?id=${id}`, { method: "DELETE" });
    if (res.ok) setRows((rs) => rs.filter((r) => r.id !== id));
  }

  async function importFile(file: File) {
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch("/api/candidatures/import", { method: "POST", body: fd });
    if (res.ok) router.refresh();
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-5">
        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Rechercher…"
          className="h-10 w-64 rounded-md bg-surface border border-border px-3 text-body focus:outline-none focus:border-accent focus:ring-[3px] focus:ring-accent/15"
        />
        <select
          value={statusFilter ?? ""}
          onChange={(e) => setStatusFilter(e.target.value || null)}
          className="h-10 rounded-md bg-surface border border-border px-3 text-body"
        >
          <option value="">Tous statuts</option>
          {STATUS_OPTIONS.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
        <span className="ml-auto flex items-center gap-2">
          <input
            ref={fileInput}
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) importFile(f);
            }}
          />
          <Button variant="secondary" onClick={() => fileInput.current?.click()}>
            <Upload className="h-4 w-4" /> Importer
          </Button>
          <Button variant="secondary" asChild>
            <a href="/api/candidatures/export" download>
              <Download className="h-4 w-4" /> Exporter
            </a>
          </Button>
        </span>
      </div>

      <div className="bg-bg rounded-lg shadow-card overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="text-caption uppercase tracking-wide text-textSecondary">
              <th className="text-left px-4 py-3 font-medium">Date</th>
              <th className="text-left px-4 py-3 font-medium">Entreprise</th>
              <th className="text-left px-4 py-3 font-medium">Poste</th>
              <th className="text-left px-4 py-3 font-medium">Pays</th>
              <th className="text-left px-4 py-3 font-medium">Score</th>
              <th className="text-left px-4 py-3 font-medium">Deadline</th>
              <th className="text-left px-4 py-3 font-medium">Statut</th>
              <th className="text-left px-4 py-3 font-medium">Notes</th>
              <th className="text-left px-4 py-3 font-medium">Contact</th>
              <th className="px-4 py-3 font-medium text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={10} className="text-center py-12 text-textSecondary">
                  Aucune candidature.
                </td>
              </tr>
            ) : (
              filtered.map((r, idx) => (
                <tr
                  key={r.id}
                  className={`text-small border-t border-border ${idx % 2 ? "bg-surface/40" : ""} hover:bg-surface`}
                >
                  <td className="px-4 py-3 text-textSecondary whitespace-nowrap">
                    {r.applied_at?.split(" ")[0] ?? ""}
                  </td>
                  <td className="px-4 py-3 font-medium">{r.offre_company ?? r.ext_company ?? ""}</td>
                  <td className="px-4 py-3">{r.offre_title ?? r.ext_title ?? ""}</td>
                  <td className="px-4 py-3 text-textSecondary">{r.offre_country ?? r.ext_country ?? ""}</td>
                  <td className="px-4 py-3">
                    <span className="font-semibold">{r.offre_score ?? r.ext_score ?? "—"}</span>
                  </td>
                  <td className="px-4 py-3">
                    <input
                      type="date"
                      value={r.deadline ?? ""}
                      onChange={(e) => patch(r.id, { deadline: e.target.value })}
                      className="bg-transparent border-0 text-small focus:outline-none focus:ring-1 focus:ring-accent rounded px-1"
                    />
                  </td>
                  <td className="px-4 py-3">
                    <select
                      value={r.status}
                      onChange={(e) => patch(r.id, { status: e.target.value })}
                      className="bg-transparent border-0 text-small focus:outline-none focus:ring-1 focus:ring-accent rounded"
                    >
                      {STATUS_OPTIONS.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-4 py-3">
                    <input
                      type="text"
                      value={r.notes ?? ""}
                      onChange={(e) => patch(r.id, { notes: e.target.value })}
                      className="w-40 bg-transparent border-0 text-small focus:outline-none focus:ring-1 focus:ring-accent rounded px-1"
                    />
                  </td>
                  <td className="px-4 py-3">
                    <input
                      type="text"
                      value={r.contact ?? ""}
                      onChange={(e) => patch(r.id, { contact: e.target.value })}
                      className="w-32 bg-transparent border-0 text-small focus:outline-none focus:ring-1 focus:ring-accent rounded px-1"
                    />
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <div className="inline-flex gap-1">
                      {(r.offre_url || r.ext_url) && (
                        <a
                          href={r.offre_url ?? r.ext_url ?? "#"}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="h-8 w-8 inline-flex items-center justify-center rounded-md hover:bg-bg text-textSecondary"
                          title="Voir l'offre"
                        >
                          <ExternalLink className="h-4 w-4" />
                        </a>
                      )}
                      <button
                        onClick={() => remove(r.id)}
                        className="h-8 w-8 inline-flex items-center justify-center rounded-md hover:bg-danger/10 text-textSecondary hover:text-danger"
                        title="Supprimer"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
