"use client";

import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowUpRight, CalendarDays, Check, ChevronDown, Download, FileSpreadsheet, Search, StickyNote, Trash2, Upload, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { CandidatureWithOffre } from "@/lib/db/candidatures";

const STATUS_OPTIONS: { id: string; label: string; variant: BadgeVariant }[] = [
  { id: "envoyee", label: "Envoyée", variant: "info" },
  { id: "en_cours", label: "En cours", variant: "warning" },
  { id: "entretien", label: "Entretien", variant: "warning" },
  { id: "acceptee", label: "Acceptée", variant: "success" },
  { id: "refusee", label: "Refusée", variant: "danger" },
];

const STAGES = [
  { id: "", label: "Toutes" },
  { id: "en_cours", label: "En cours" },
  { id: "envoyee", label: "Envoyées" },
  { id: "entretien", label: "Entretiens" },
  { id: "decisions", label: "Décisions" },
] as const;
const EMPTY_STAGE_COPY: Record<string, { title: string; description: string }> = {
  en_cours: { title: "Aucune candidature en préparation", description: "Depuis une offre, ajoutez-la au suivi pour préparer votre dossier." },
  envoyee: { title: "Aucune candidature envoyée", description: "Après avoir postulé sur le site de l'annonce, passez son statut à « Envoyée »." },
  entretien: { title: "Aucun entretien pour le moment", description: "Les entretiens apparaîtront ici lorsque vous changerez le statut d'une candidature." },
  decisions: { title: "Aucune décision enregistrée", description: "Les candidatures acceptées ou refusées apparaîtront ici." },
};

const UNSAVED_MESSAGE = "Des modifications du suivi ne sont pas enregistrées. Quitter la page sans les enregistrer ?";

/** Brouillon des champs à enregistrement explicite (le statut, lui, part dès qu'on le change). */
type Draft = { notes: string; contact: string; deadline: string; follow_up_date: string };
type Row = CandidatureWithOffre;

function matchesStage(status: string, stage: string): boolean {
  return !stage || (stage === "decisions" ? status === "acceptee" || status === "refusee" : status === stage);
}

function statusMeta(status: string) {
  return STATUS_OPTIONS.find((item) => item.id === status) ?? { label: status, variant: "default" as const };
}

function displayDate(value: string | null | undefined): string {
  if (!value) return "—";
  const datePart = value.slice(0, 10);
  const date = new Date(`${datePart}T12:00:00`);
  return Number.isNaN(date.getTime()) ? datePart : date.toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" });
}

// Les chaînes vides comptent comme absentes : certaines sources n'ont pas d'entreprise.
const rowTitle = (row: Row) => row.offre_title || row.ext_title || "Poste non précisé";
const rowCompany = (row: Row) => row.offre_company || row.ext_company || "Entreprise non précisée";
const rowCountry = (row: Row) => row.offre_country || row.ext_country || null;
const rowScore = (row: Row) => row.offre_score ?? row.ext_score ?? null;

/**
 * Lien de l'annonce d'origine (page où l'on postule). Seuls http(s) sont acceptés :
 * une candidature importée depuis un fichier Excel peut contenir n'importe quelle valeur.
 */
function applyUrl(row: Row): string | null {
  const url = (row.offre_url || row.ext_url || "").trim();
  return /^https?:\/\//i.test(url) ? url : null;
}

function savedDraft(row: Row): Draft {
  return { notes: row.notes ?? "", contact: row.contact ?? "", deadline: row.deadline ?? "", follow_up_date: row.follow_up_date ?? "" };
}

function sameDraft(a: Draft, b: Draft): boolean {
  return a.notes === b.notes && a.contact === b.contact && a.deadline === b.deadline && a.follow_up_date === b.follow_up_date;
}

export function CandidaturesTable({ initial }: { initial: Row[] }) {
  const [rows, setRows] = useState(initial);
  const [drafts, setDrafts] = useState<Record<number, Draft>>({});
  const [openRows, setOpenRows] = useState<Set<number>>(new Set());
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const router = useRouter();

  useEffect(() => setRows(initial), [initial]);
  const filtered = useMemo(() => rows.filter((row) => {
    if (!matchesStage(row.status, statusFilter)) return false;
    const haystack = [row.offre_company, row.offre_title, row.ext_company, row.ext_title, row.notes, row.contact].filter(Boolean).join(" ").toLowerCase();
    return !query || haystack.includes(query.toLowerCase());
  }), [rows, query, statusFilter]);
  const dirtyIds = useMemo(() => new Set(rows.filter((row) => drafts[row.id] && !sameDraft(drafts[row.id], savedDraft(row))).map((row) => row.id)), [rows, drafts]);
  const dirtyCount = dirtyIds.size;
  const emptyState = rows.length === 0
    ? { title: "Un suivi clair, dès la première candidature", description: "Depuis une offre, ajoutez la candidature au suivi. Vous pourrez noter les contacts, les échéances et les prochaines étapes." }
    : query ? { title: "Aucun résultat", description: "Essayez un autre mot clé ou choisissez une autre étape." }
    : EMPTY_STAGE_COPY[statusFilter] ?? { title: "Aucun résultat", description: "Modifiez la recherche ou choisissez une autre étape." };

  // Avertissement si l'on quitte avec des modifications non enregistrées :
  // fermeture ou rechargement de l'onglet (beforeunload)…
  useEffect(() => {
    if (!dirtyCount) return;
    function onBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = "";
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirtyCount]);

  // …et navigation interne (liens Next.js, que beforeunload ne voit pas). Écoute en capture
  // sur document : le clic est arrêté avant d'atteindre le routeur si l'on choisit de rester.
  useEffect(() => {
    if (!dirtyCount) return;
    function onClick(event: MouseEvent) {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (!(anchor instanceof HTMLAnchorElement) || anchor.hasAttribute("download")) return;
      if (anchor.target && anchor.target !== "_self") return;
      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;
      if (window.confirm(UNSAVED_MESSAGE)) return;
      event.preventDefault();
      event.stopPropagation();
    }
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [dirtyCount]);

  async function patch(id: number, body: Record<string, string | null>): Promise<boolean> {
    setError(null);
    try {
      const res = await fetch("/api/candidatures", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, ...body }) });
      if (!res.ok) throw new Error("La modification n'a pas pu être enregistrée.");
      setRows((current) => current.map((row) => row.id === id ? { ...row, ...body } : row));
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Erreur réseau.");
      return false;
    }
  }

  function dropDraft(id: number) {
    setDrafts((current) => {
      if (!(id in current)) return current;
      const next = { ...current };
      delete next[id];
      return next;
    });
  }

  function editDraft(row: Row, change: Partial<Draft>) {
    setDrafts((current) => ({ ...current, [row.id]: { ...(current[row.id] ?? savedDraft(row)), ...change } }));
  }

  async function saveDraft(row: Row): Promise<boolean> {
    const draft = drafts[row.id] ?? savedDraft(row);
    const ok = await patch(row.id, { notes: draft.notes || null, contact: draft.contact || null, deadline: draft.deadline || null, follow_up_date: draft.follow_up_date || null });
    if (ok) dropDraft(row.id);
    return ok;
  }

  async function changeStatus(row: Row, next: string) {
    const previous = row.status;
    setRows((current) => current.map((item) => item.id === row.id ? { ...item, status: next } : item));
    if (!await patch(row.id, { status: next })) setRows((current) => current.map((item) => item.id === row.id ? { ...item, status: previous } : item));
  }

  async function remove(id: number): Promise<void> {
    setError(null);
    try {
      const res = await fetch(`/api/candidatures?id=${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("La candidature n'a pas pu être supprimée.");
      setRows((current) => current.filter((row) => row.id !== id));
      dropDraft(id);
      setOpenRows((current) => { const next = new Set(current); next.delete(id); return next; });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Erreur réseau.");
    }
  }

  function toggleRow(id: number) {
    setOpenRows((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function importFile(file: File) {
    setError(null);
    setNotice(null);
    if (file.size > 10 * 1024 * 1024) { setError("Le fichier dépasse 10 Mo. Choisissez un export plus léger."); return; }
    setImporting(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/candidatures/import", { method: "POST", body: form });
      if (!res.ok) throw new Error("Import impossible. Vérifiez que le fichier contient un tableau Excel valide.");
      const result = await res.json().catch(() => ({})) as { imported?: number };
      const fresh = await fetch("/api/candidatures").then((response) => response.json());
      if (Array.isArray(fresh.candidatures)) setRows(fresh.candidatures);
      if (typeof result.imported === "number") setNotice(`${result.imported} candidature${result.imported > 1 ? "s importées" : " importée"}.`);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Erreur réseau.");
    } finally {
      setImporting(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  const editorFor = (row: Row, layout: "card" | "row") => (
    <CandidatureEditor
      row={row}
      layout={layout}
      draft={drafts[row.id] ?? savedDraft(row)}
      dirty={dirtyIds.has(row.id)}
      onDraft={(change) => editDraft(row, change)}
      onReset={() => dropDraft(row.id)}
      onSave={() => saveDraft(row)}
      onStatus={(next) => void changeStatus(row, next)}
      onRemove={() => remove(row.id)}
    />
  );

  return (
    <div>
      <nav aria-label="Étapes des candidatures" className="mb-5 flex gap-2 overflow-x-auto pb-2 sm:grid sm:grid-cols-5 sm:overflow-visible sm:pb-0">
        {STAGES.map((stage) => {
          const active = statusFilter === stage.id;
          const count = rows.filter((row) => matchesStage(row.status, stage.id)).length;
          return <button key={stage.id} type="button" onClick={() => setStatusFilter(stage.id)} aria-current={active ? "true" : undefined} className="glass-panel stage-card min-h-[100px] min-w-[112px] shrink-0 !rounded-[18px] px-4 py-4 text-left transition-colors hover:border-accent/30 sm:min-w-0">
            <span className={`block text-caption font-semibold ${active ? "text-text" : "text-textSecondary"}`}>{stage.label}</span>
            <span className="mt-3 block font-display text-[30px] font-light leading-none tabular-nums">{count}</span>
          </button>;
        })}
      </nav>
      <section aria-label="Rechercher dans les candidatures" className="glass-panel flex flex-col gap-3 p-4 sm:flex-row sm:flex-wrap sm:items-center sm:p-5">
        <label className="relative min-w-[180px] flex-1">
          <span className="sr-only">Rechercher une candidature</span>
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-textSecondary" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Entreprise, poste, contact…" className="h-11 w-full rounded-md border border-border bg-bg pl-10 pr-3 text-body focus:border-accent focus:outline-none" />
        </label>
        <div className="flex flex-wrap gap-2 sm:ml-auto">
          <input ref={fileInput} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) void importFile(file); }} />
          <Button variant="secondary" onClick={() => fileInput.current?.click()} disabled={importing}><Upload className="h-4 w-4" /> {importing ? "Import…" : "Importer"}</Button>
          <Button variant="secondary" asChild><a href="/api/candidatures/export" download><Download className="h-4 w-4" /> Exporter</a></Button>
        </div>
      </section>

      {error && <p role="alert" className="mt-4 rounded-md border border-danger bg-surface px-4 py-3 text-small text-text">{error}</p>}
      {notice && <p role="status" className="mt-4 flex items-center gap-2 rounded-md border border-border bg-surface px-4 py-3 text-small text-text"><Check className="h-4 w-4 shrink-0 text-success" /> {notice}</p>}

      <div className="mb-4 mt-7">
        <h2 className="font-display text-h2">Votre suivi</h2>
        <p className="mt-1 text-small text-textSecondary" aria-live="polite">
          {filtered.length} candidature{filtered.length > 1 ? "s" : ""} affichée{filtered.length > 1 ? "s" : ""}
          {dirtyCount > 0 && <> · <strong className="font-semibold text-text">{dirtyCount} modification{dirtyCount > 1 ? "s" : ""} non enregistrée{dirtyCount > 1 ? "s" : ""}</strong></>}
        </p>
      </div>

      {filtered.length === 0 ? (
        <div className="glass-panel px-6 py-14 text-center">
          <FileSpreadsheet className="mx-auto mb-4 h-8 w-8 text-accent" />
          <h3 className="font-display text-h2">{emptyState.title}</h3>
          <p className="mx-auto mt-2 max-w-[44ch] text-body text-textSecondary">{emptyState.description}</p>
          {rows.length === 0 && <Link href="/offres" className="mt-5 inline-flex items-center gap-1 text-small font-semibold text-accent hover:underline">Explorer les offres <ArrowUpRight className="h-4 w-4" /></Link>}
        </div>
      ) : (
        <>
          {/* Sous xl : cartes. À partir de xl : tableau compact (23 candidatures en cartes = 3 fois la hauteur). */}
          <div className="space-y-3 xl:hidden">
            {filtered.map((row) => <CandidatureCard key={row.id} row={row} dirty={dirtyIds.has(row.id)} editor={editorFor(row, "card")} />)}
          </div>
          <div className="glass-panel hidden overflow-hidden xl:block">
            <table className="w-full table-fixed text-small">
              <caption className="sr-only">Candidatures suivies</caption>
              <colgroup>
                <col />
                <col className="w-[112px]" />
                <col className="w-[116px]" />
                <col className="w-[64px]" />
                <col className="w-[20%]" />
                <col className="w-[200px]" />
              </colgroup>
              <thead>
                <tr className="border-b border-border text-left text-caption text-textSecondary">
                  <th scope="col" className="px-5 py-3 font-semibold">Poste</th>
                  <th scope="col" className="px-3 py-3 font-semibold">Statut</th>
                  <th scope="col" className="px-3 py-3 font-semibold">Échéance / relance</th>
                  <th scope="col" className="px-3 py-3 text-right font-semibold">Score</th>
                  <th scope="col" className="px-3 py-3 font-semibold">Contact et notes</th>
                  <th scope="col" className="px-5 py-3 text-right font-semibold"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((row) => {
                  const open = openRows.has(row.id);
                  const meta = statusMeta(row.status);
                  const url = applyUrl(row);
                  const country = rowCountry(row);
                  const score = rowScore(row);
                  const editId = `candidature-edit-${row.id}`;
                  return (
                    <Fragment key={row.id}>
                      <tr className={cn("border-b border-border align-top transition-colors hover:bg-surfaceHover", open && "bg-surfaceHover")}>
                        <td className="px-5 py-3">
                          {row.offre_id
                            ? <Link href={`/offres/${row.offre_id}`} className="line-clamp-2 font-semibold leading-snug hover:text-accent" title={rowTitle(row)}>{rowTitle(row)}</Link>
                            : <span className="line-clamp-2 font-semibold leading-snug" title={rowTitle(row)}>{rowTitle(row)}</span>}
                          <p className="mt-0.5 truncate text-caption text-textSecondary">{rowCompany(row)}{country ? ` · ${country}` : ""} · ajoutée le {displayDate(row.applied_at)}</p>
                        </td>
                        <td className="px-3 py-3"><Badge variant={meta.variant}>{meta.label}</Badge></td>
                        <td className="px-3 py-3">
                          <div className="space-y-1 whitespace-nowrap">
                            {row.deadline && <p>{displayDate(row.deadline)} · échéance</p>}
                            {row.follow_up_date && <p className="text-textSecondary">{displayDate(row.follow_up_date)} · relance</p>}
                            {!row.deadline && !row.follow_up_date && <span className="text-textSecondary">—</span>}
                          </div>
                        </td>
                        <td className="px-3 py-3 text-right font-semibold tabular-nums">{score ?? <span className="font-normal text-textSecondary">—</span>}</td>
                        <td className="px-3 py-3 text-textSecondary">
                          {row.contact || row.notes ? (
                            <>
                              {row.contact && <p className="truncate" title={row.contact}><span className="sr-only">Contact : </span>{row.contact}</p>}
                              {row.notes && <p className="line-clamp-1" title={row.notes}><span className="sr-only">Notes : </span>{row.notes}</p>}
                            </>
                          ) : "—"}
                        </td>
                        <td className="py-3 pl-2 pr-5 text-right">
                          <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1">
                            {url && <AnnonceLink url={url} status={row.status} />}
                            <button type="button" onClick={() => toggleRow(row.id)} aria-expanded={open} aria-controls={editId} className="inline-flex min-h-11 items-center gap-1 font-semibold text-text hover:text-accent">
                              {open ? "Fermer" : "Modifier"} <ChevronDown className={cn("h-4 w-4 transition-transform", open && "rotate-180")} />
                            </button>
                          </div>
                          {dirtyIds.has(row.id) && <p className="text-caption font-semibold text-text">Non enregistré</p>}
                        </td>
                      </tr>
                      {open && (
                        <tr id={editId} className="border-b border-border bg-surfaceHover">
                          <td colSpan={6} className="px-5 pb-4">{editorFor(row, "row")}</td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function AnnonceLink({ url, status, className }: { url: string; status: string; className?: string }) {
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className={cn("inline-flex min-h-11 items-center gap-1 font-semibold text-accent hover:underline", className)} title={`Ouvrir l'annonce d'origine : ${url}`}>
      {status === "en_cours" ? "Postuler" : "Annonce"} <ArrowUpRight className="h-4 w-4" />
    </a>
  );
}

function CandidatureCard({ row, dirty, editor }: { row: Row; dirty: boolean; editor: ReactNode }) {
  const meta = statusMeta(row.status);
  const url = applyUrl(row);
  const country = rowCountry(row);
  const score = rowScore(row);

  return (
    <article className="glass-panel p-5 sm:p-6">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="mb-1 text-small font-semibold text-textSecondary">{rowCompany(row)}</p>
          {row.offre_id ? <Link href={`/offres/${row.offre_id}`} className="font-display text-[21px] font-semibold leading-tight hover:text-accent">{rowTitle(row)}</Link> : <h3 className="font-display text-[21px] font-semibold leading-tight">{rowTitle(row)}</h3>}
          <p className="mt-2 text-small text-textSecondary">Ajoutée le {displayDate(row.applied_at)}{country ? ` · ${country}` : ""}</p>
        </div>
        <Badge variant={meta.variant} className="mt-0.5">{meta.label}</Badge>
      </div>

      {(row.contact || row.notes) && (
        <div className="mt-3 space-y-1.5 text-small text-textSecondary">
          {row.contact && <p className="flex min-w-0 items-center gap-1.5"><UserRound className="h-4 w-4 shrink-0" aria-hidden="true" /><span className="truncate"><span className="sr-only">Contact : </span>{row.contact}</span></p>}
          {row.notes && <p className="flex items-start gap-1.5"><StickyNote className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /><span className="line-clamp-2 whitespace-pre-line"><span className="sr-only">Notes : </span>{row.notes}</span></p>}
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-border pt-4 text-small">
        {score != null && <span><strong className="tabular-nums">{score}</strong><span className="text-textSecondary"> / 100 d'adéquation</span></span>}
        <span className="inline-flex items-center gap-1.5 text-textSecondary"><CalendarDays className="h-4 w-4" />{row.deadline || row.follow_up_date ? ` ${row.deadline ? `Échéance : ${displayDate(row.deadline)}` : ""}${row.deadline && row.follow_up_date ? " · " : ""}${row.follow_up_date ? `Relance : ${displayDate(row.follow_up_date)}` : ""}` : " Aucun rappel prévu"}</span>
        {url && <AnnonceLink url={url} status={row.status} className="sm:ml-auto" />}
      </div>

      <details className="group mt-4 border-t border-border pt-3">
        <summary className="flex min-h-11 list-none flex-wrap items-center gap-x-1.5 text-small font-semibold text-accent marker:hidden">
          <span className="inline-flex items-center gap-1.5 hover:underline">Modifier le suivi <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" /></span>
          {dirty && <span className="font-semibold text-text">· modifications non enregistrées</span>}
        </summary>
        {editor}
      </details>
    </article>
  );
}

function CandidatureEditor({ row, layout, draft, dirty, onDraft, onReset, onSave, onStatus, onRemove }: {
  row: Row;
  layout: "card" | "row";
  draft: Draft;
  dirty: boolean;
  onDraft: (change: Partial<Draft>) => void;
  onReset: () => void;
  onSave: () => Promise<boolean>;
  onStatus: (next: string) => void;
  onRemove: () => Promise<void>;
}) {
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [removing, setRemoving] = useState(false);
  const fieldClass = "mt-1.5 h-11 w-full rounded-md border border-border bg-bg px-3 font-normal focus:border-accent focus:outline-none";

  async function save() {
    setSaving(true);
    const ok = await onSave();
    setSaving(false);
    if (ok) { setSaved(true); window.setTimeout(() => setSaved(false), 1800); }
  }

  async function confirmRemove() {
    setRemoving(true);
    await onRemove();
    setRemoving(false);
  }

  return (
    <div>
      <div className={cn("grid gap-4 pt-4", layout === "row" ? "grid-cols-3" : "sm:grid-cols-2")}>
        <label className="text-small font-semibold">Statut
          <select value={row.status} onChange={(event) => onStatus(event.target.value)} className={fieldClass}>
            {STATUS_OPTIONS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
          </select>
        </label>
        <label className="text-small font-semibold">Échéance
          <input type="date" value={draft.deadline} onChange={(event) => onDraft({ deadline: event.target.value })} className={fieldClass} />
        </label>
        <label className="text-small font-semibold">Date de relance
          <input type="date" value={draft.follow_up_date} onChange={(event) => onDraft({ follow_up_date: event.target.value })} className={fieldClass} />
        </label>
        <label className="text-small font-semibold">Contact
          <input type="text" value={draft.contact} onChange={(event) => onDraft({ contact: event.target.value })} placeholder="Nom ou adresse email" className={fieldClass} />
        </label>
        <label className={cn("text-small font-semibold", layout === "row" ? "col-span-3" : "sm:col-span-2")}>Notes
          <textarea value={draft.notes} onChange={(event) => onDraft({ notes: event.target.value })} rows={3} placeholder="Prochaine étape, échange, relance…" className="mt-1.5 w-full rounded-md border border-border bg-bg px-3 py-2 font-normal focus:border-accent focus:outline-none" />
        </label>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={() => void save()} disabled={!dirty || saving}>{saving ? "Enregistrement…" : "Enregistrer les détails"}</Button>
          {dirty && !saving && <Button size="sm" variant="ghost" onClick={onReset}>Annuler les modifications</Button>}
          {saved && <span role="status" className="inline-flex items-center gap-1 text-small text-text"><Check className="h-4 w-4 text-success" /> Enregistré</span>}
        </div>
        {!confirmDelete
          ? <button type="button" onClick={() => setConfirmDelete(true)} className="inline-flex min-h-11 items-center gap-1 text-small text-textSecondary hover:text-danger"><Trash2 className="h-4 w-4" /> Supprimer</button>
          : <span className="flex flex-wrap items-center gap-2 text-small">
              <span>Supprimer cette candidature ?</span>
              <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)} disabled={removing}>Annuler</Button>
              <Button size="sm" variant="danger" onClick={() => void confirmRemove()} disabled={removing}>{removing ? "Suppression…" : "Supprimer"}</Button>
            </span>}
      </div>
    </div>
  );
}
