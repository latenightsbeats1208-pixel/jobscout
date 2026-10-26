"use client";
import { useMemo, useRef, useState } from "react";
import { AlertCircle, Check, Download, Eye, FileJson, Trash2, Upload } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import type { CvTemplate } from "@/lib/cvtemplate/types";
import { setAtPath, type TemplateText } from "@/lib/cvtemplate/inspect";

type Status = { text: string; error?: boolean; details?: string[] } | null;

function StatusBox({ status }: { status: Status }) {
  if (!status) return null;
  return (
    <div
      role={status.error ? "alert" : "status"}
      className={`mt-3 rounded-md border bg-surface p-3 text-small text-text ${status.error ? "border-danger" : "border-border"}`}
    >
      <div className="flex items-start gap-2">
        {status.error ? <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-danger" /> : <Check className="mt-0.5 h-4 w-4 shrink-0 text-success" />}
        <span>{status.text}</span>
      </div>
      {status.details && status.details.length > 0 && (
        <ul className="mt-2 list-disc space-y-0.5 pl-8 text-caption text-textSecondary">
          {status.details.map((d, i) => <li key={i}>{d}</li>)}
        </ul>
      )}
    </div>
  );
}

export function TemplateEditor({
  initial,
  initialPlaceholders,
  initialMissingEnglish,
}: {
  initial: CvTemplate | null;
  initialPlaceholders: TemplateText[];
  initialMissingEnglish: string[];
}) {
  const [template, setTemplate] = useState<CvTemplate | null>(initial);
  const [placeholders, setPlaceholders] = useState(initialPlaceholders);
  const [missingEn, setMissingEn] = useState(initialMissingEnglish);
  const [json, setJson] = useState(initial ? JSON.stringify(initial, null, 2) : "");
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>(null);
  const [showJson, setShowJson] = useState(!initial);
  const fileRef = useRef<HTMLInputElement>(null);

  const bulletCount = useMemo(
    () => template?.sections.reduce((n, s) => n + s.entries.reduce((m, e) => m + e.bullets.length, 0), 0) ?? 0,
    [template]
  );

  async function save(next: unknown, label: string) {
    setBusy(label);
    setStatus(null);
    try {
      const res = await fetch("/api/cv-template", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(next),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setStatus({ text: data.error ?? `Erreur (HTTP ${res.status}).`, error: true, details: data.errors });
        return false;
      }
      setTemplate(data.template);
      setPlaceholders(data.placeholders ?? []);
      setMissingEn(data.missingEnglish ?? []);
      setJson(JSON.stringify(data.template, null, 2));
      setEdits({});
      setStatus({ text: "Modèle enregistré." });
      return true;
    } finally {
      setBusy(null);
    }
  }

  function saveJson() {
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch (e) {
      setStatus({ text: `JSON invalide : ${e instanceof Error ? e.message : String(e)}`, error: true });
      return;
    }
    void save(parsed, "json");
  }

  function savePlaceholders() {
    if (!template) return;
    let next = template;
    for (const [path, value] of Object.entries(edits)) next = setAtPath(next, path, value);
    void save(next, "placeholders");
  }

  async function importFile(file: File) {
    const text = await file.text();
    setJson(text);
    try {
      await save(JSON.parse(text), "import");
    } catch (e) {
      setStatus({ text: `Fichier illisible : ${e instanceof Error ? e.message : String(e)}`, error: true });
    }
  }

  function exportJson() {
    if (!template) return;
    const blob = new Blob([JSON.stringify(template, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "cv-template.json";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function remove() {
    if (!confirm("Supprimer le modèle ? Les CV seront de nouveau rédigés par l'IA à partir du profil.")) return;
    setBusy("delete");
    try {
      await fetch("/api/cv-template", { method: "DELETE" });
      setTemplate(null);
      setPlaceholders([]);
      setMissingEn([]);
      setShowJson(true);
      setStatus({ text: "Modèle supprimé." });
    } finally {
      setBusy(null);
    }
  }

  const fileInput = (
    <input
      ref={fileRef}
      type="file"
      accept="application/json,.json"
      className="hidden"
      onChange={(e) => {
        const f = e.target.files?.[0];
        if (f) void importFile(f);
        e.target.value = "";
      }}
    />
  );

  if (!template) {
    return (
      <Card>
        <h2 className="text-h3">Aucun modèle pour l'instant</h2>
        <p className="mt-2 max-w-[70ch] text-body text-textSecondary">
          Sans modèle, JobScout rédige chaque CV avec l'IA à partir de votre profil. Importez votre fichier
          <code className="mx-1">cv-template.json</code> (ou collez son contenu) pour que chaque CV soit assemblé à partir de vos propres textes.
          Sur un serveur, vous pouvez aussi déposer ce fichier dans le dossier de données : il est importé au premier accès.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button onClick={() => fileRef.current?.click()} disabled={!!busy}>
            {busy === "import" ? <Spinner size={16} className="text-onAccent" /> : <Upload className="h-4 w-4" />} Importer un fichier
          </Button>
        </div>
        {fileInput}
        <Textarea className="mt-4 min-h-[220px] font-mono text-caption" value={json} onChange={(e) => setJson(e.target.value)} placeholder="… ou collez le JSON du modèle ici" spellCheck={false} />
        <Button className="mt-3" variant="secondary" onClick={saveJson} disabled={!!busy || !json.trim()}>
          {busy === "json" ? <Spinner size={16} /> : <Check className="h-4 w-4" />} Enregistrer
        </Button>
        <StatusBox status={status} />
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-h3">{template.identity.full_name}</h2>
            <p className="mt-1 text-small text-textSecondary">
              {template.clusters.length} clusters · {bulletCount} puces · {template.sections.length} sections
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={exportJson}><Download className="h-4 w-4" /> Exporter</Button>
            <Button variant="secondary" onClick={() => fileRef.current?.click()} disabled={!!busy}><Upload className="h-4 w-4" /> Importer</Button>
            <Button variant="ghost" onClick={remove} disabled={!!busy}><Trash2 className="h-4 w-4" /> Supprimer</Button>
          </div>
        </div>
        {fileInput}

        <div className="mt-5 overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-small">
            <thead className="text-caption uppercase tracking-wide text-textSecondary">
              <tr><th className="py-2 pr-3">Cluster</th><th className="py-2 pr-3">Titre par défaut</th><th className="py-2 pr-3">Sections</th><th className="py-2">Aperçu</th></tr>
            </thead>
            <tbody className="divide-y divide-border">
              {template.clusters.map((c) => (
                <tr key={c.id}>
                  <td className="py-2.5 pr-3 align-top"><Badge variant="info">{c.id}</Badge> <span className="ml-1 font-medium">{c.name}</span></td>
                  <td className="py-2.5 pr-3 align-top text-textSecondary">{c.headline.fr}</td>
                  <td className="py-2.5 pr-3 align-top text-textSecondary">{c.order.join(" → ")}</td>
                  <td className="py-2.5 align-top whitespace-nowrap">
                    {(["fr", "en"] as const).map((lang) => (
                      <a key={lang} className="mr-3 inline-flex items-center gap-1 text-accent hover:underline" href={`/api/cv-template/preview?cluster=${encodeURIComponent(c.id)}&lang=${lang}${lang === "en" ? "&country=CH" : ""}`} target="_blank" rel="noopener noreferrer">
                        <Eye className="h-3.5 w-3.5" /> {lang.toUpperCase()}
                      </a>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card>
        <div className="flex items-center gap-2">
          <h2 className="text-h3">À compléter avant d'envoyer</h2>
          <Badge variant={placeholders.length ? "warning" : "success"}>{placeholders.length || "rien"}</Badge>
        </div>
        {placeholders.length === 0 ? (
          <p className="mt-2 text-small text-textSecondary">Aucun emplacement entre crochets : vos CV sont prêts à partir.</p>
        ) : (
          <>
            <p className="mt-2 text-small text-textSecondary">
              Ces textes contiennent encore un emplacement entre crochets (<code>[N]</code>, <code>[mois]</code>…). Tant qu'il reste, chaque CV généré le signale.
            </p>
            <div className="mt-4 space-y-4">
              {placeholders.map((p) => (
                <label key={p.path} className="block">
                  <span className="mb-1 flex items-center gap-2 text-caption font-semibold text-textSecondary">
                    {p.where} <Badge>{p.lang.toUpperCase()}</Badge> <span className="font-normal">{p.placeholders.join(" ")}</span>
                  </span>
                  <Textarea
                    className="min-h-[64px] text-small"
                    value={edits[p.path] ?? p.text}
                    onChange={(e) => setEdits((x) => ({ ...x, [p.path]: e.target.value }))}
                  />
                </label>
              ))}
            </div>
            <Button className="mt-4" onClick={savePlaceholders} disabled={!!busy || Object.keys(edits).length === 0}>
              {busy === "placeholders" ? <Spinner size={16} className="text-onAccent" /> : <Check className="h-4 w-4" />} Enregistrer ces textes
            </Button>
          </>
        )}
        {missingEn.length > 0 && (
          <p className="mt-4 text-small text-textSecondary">
            Sans version anglaise (le français sera utilisé dans un CV en anglais) : {missingEn.join(", ")}.
          </p>
        )}
      </Card>

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-h3">Édition complète</h2>
            <p className="mt-1 text-small text-textSecondary">Clusters, puces, étiquettes, limites et blocs de compétences, au format JSON. Le modèle est vérifié avant d'être enregistré.</p>
          </div>
          <Button variant="secondary" onClick={() => setShowJson((v) => !v)}><FileJson className="h-4 w-4" /> {showJson ? "Masquer" : "Afficher"} le JSON</Button>
        </div>
        {showJson && (
          <>
            <Textarea className="mt-4 min-h-[480px] font-mono text-caption" value={json} onChange={(e) => setJson(e.target.value)} spellCheck={false} />
            <Button className="mt-3" onClick={saveJson} disabled={!!busy}>
              {busy === "json" ? <Spinner size={16} className="text-onAccent" /> : <Check className="h-4 w-4" />} Enregistrer le JSON
            </Button>
          </>
        )}
      </Card>
      <StatusBox status={status} />
    </div>
  );
}
