"use client";
import { useState } from "react";
import { Check, FileText, Mail, MessageSquare, Send, Download, Sparkles, FolderOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

type DocsState = {
  cv_pdf_id: number | null;
  cv_docx_id: number | null;
  lm_pdf_id: number | null;
  lm_docx_id: number | null;
  msg_id: number | null;
};

async function openFolder(path: string) {
  try {
    await fetch("/api/settings/open-folder", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path }),
    });
  } catch {
    // best-effort — silently ignore
  }
}

export function ActionsPanel({
  offreId,
  offreUrl,
  isVie,
  initial,
  initialFolder = null,
}: {
  offreId: number;
  offreUrl: string;
  isVie: boolean;
  initial: {
    cv_pdf_id: number | null;
    cv_docx_id: number | null;
    lm_pdf_id: number | null;
    lm_docx_id: number | null;
    msg_id: number | null;
  };
  initialFolder?: string | null;
}) {
  const [docs, setDocs] = useState<DocsState>(initial);
  const [allLoading, setAllLoading] = useState(false);
  const [msgLoading, setMsgLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [msgPreview, setMsgPreview] = useState<{ text: string; length: number } | null>(null);
  const [applyLoading, setApplyLoading] = useState(false);
  const [applied, setApplied] = useState(false);
  const [folder, setFolder] = useState<string | null>(initialFolder);

  // Un document existe dès qu'un de ses deux formats est enregistré : sur un
  // échec survenu entre l'écriture du PDF et celle du DOCX, la ligne doit
  // quand même apparaître avec le seul lien réellement disponible.
  const hasCV = !!(docs.cv_docx_id || docs.cv_pdf_id);
  const hasLM = !!(docs.lm_docx_id || docs.lm_pdf_id);

  async function generateAll() {
    setAllLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/generate/all", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ offreId }),
      });
      // res.ok AVANT res.json() : un corps non-JSON (page HTML d'erreur d'un
      // proxy/edge) ne doit pas masquer le vrai message.
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        // Échec partiel possible : la route signale ce qui a quand même été
        // généré — on met à jour l'état pour ne pas laisser de document orphelin.
        if (data?.cv || data?.lm) {
          setDocs((d) => ({
            ...d,
            ...(data.cv ? { cv_pdf_id: data.cv.pdfId, cv_docx_id: data.cv.docxId } : {}),
            ...(data.lm ? { lm_pdf_id: data.lm.pdfId, lm_docx_id: data.lm.docxId } : {}),
          }));
          if (data.folder) setFolder(data.folder);
        }
        setError(data?.error || `Erreur serveur (HTTP ${res.status}).`);
        return;
      }
      const data = await res.json().catch(() => null);
      if (!data?.cv || !data?.lm) {
        setError("Réponse du serveur illisible — réessayez.");
        return;
      }
      setDocs((d) => ({
        ...d,
        cv_pdf_id: data.cv.pdfId,
        cv_docx_id: data.cv.docxId,
        lm_pdf_id: data.lm.pdfId,
        lm_docx_id: data.lm.docxId,
      }));
      if (data.folder) {
        setFolder(data.folder);
        openFolder(data.folder);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur réseau");
    } finally {
      setAllLoading(false);
    }
  }

  async function generateMsg() {
    setMsgLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/generate/msg", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ offreId }),
      });
      // res.ok AVANT res.json() — même motif que generateAll.
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError(data?.error || `Erreur serveur (HTTP ${res.status}).`);
        return;
      }
      const data = await res.json().catch(() => null);
      if (!data) {
        setError("Réponse du serveur illisible — réessayez.");
        return;
      }
      setDocs((d) => ({ ...d, msg_id: data.document_id }));
      if (data.text) setMsgPreview({ text: data.text, length: data.length });
      if (data.folder) {
        setFolder(data.folder);
        openFolder(data.folder);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur réseau");
    } finally {
      setMsgLoading(false);
    }
  }

  async function apply() {
    setApplyLoading(true);
    setError(null);
    window.open(offreUrl, "_blank", "noopener,noreferrer");
    try {
      const res = await fetch("/api/candidatures", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          offre_id: offreId,
          cv_doc_id: docs.cv_docx_id ?? docs.cv_pdf_id,
          lm_doc_id: docs.lm_docx_id ?? docs.lm_pdf_id,
          msg_doc_id: docs.msg_id,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "La candidature n'a pas pu être enregistrée.");
        return;
      }
      setApplied(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur réseau");
    } finally {
      setApplyLoading(false);
    }
  }

  return (
    <Card className="p-5 space-y-3">
      <div>
        <h3 className="text-h3 mb-1">Actions</h3>
        <p className="text-small text-textSecondary">
          Générez vos documents (Word + PDF) puis postulez en un clic.
        </p>
      </div>

      {/* Single combined generation button */}
      <Button
        onClick={generateAll}
        size="lg"
        variant={hasCV && hasLM ? "secondary" : "primary"}
        className="w-full"
        disabled={allLoading}
      >
        {allLoading ? (
          <Spinner size={16} className="text-current" />
        ) : hasCV && hasLM ? (
          <Sparkles className="h-4 w-4" />
        ) : (
          <Sparkles className="h-4 w-4" />
        )}
        {allLoading
          ? "Génération en cours…"
          : hasCV && hasLM
          ? "Régénérer les documents"
          : "Générer les documents"}
      </Button>

      {/* Download row — primary DOCX, secondary PDF.
          Chaque ligne est conditionnée à SES PROPRES identifiants : en succès
          partiel (une branche de /api/generate/all en échec), afficher une
          ligne validée en vert pour un document inexistant laissait le dossier
          à moitié rempli sans que l'interface le dise. */}
      {(hasCV || hasLM) && (
        <div className="space-y-2 pt-1">
          {hasCV && (
            <DocRow
              icon={<FileText className="h-5 w-5" />}
              label="CV"
              docxId={docs.cv_docx_id}
              pdfId={docs.cv_pdf_id}
            />
          )}
          {hasLM && (
            <DocRow
              icon={<Mail className="h-5 w-5" />}
              label="Lettre de motivation"
              docxId={docs.lm_docx_id}
              pdfId={docs.lm_pdf_id}
            />
          )}
          {folder && (
            <button
              onClick={() => openFolder(folder)}
              className="w-full inline-flex items-center justify-center gap-1.5 text-small text-textSecondary hover:text-text py-1"
            >
              <FolderOpen className="h-3.5 w-3.5" />
              Ouvrir le dossier
            </button>
          )}
        </div>
      )}

      {/* V.I.E specific button */}
      {isVie && (
        <div className="pt-1">
          <ActionRow
            icon={<MessageSquare className="h-5 w-5" />}
            label="Message V.I.E"
            done={!!docs.msg_id}
            loading={msgLoading}
            onClick={generateMsg}
            downloadId={docs.msg_id}
            subtitle={msgPreview ? `${msgPreview.length}/2000 caractères` : "≤ 2000 caractères"}
          />
          {msgPreview && (
            <div className="bg-surface rounded-md p-3 text-small whitespace-pre-wrap mt-2">
              {msgPreview.text}
            </div>
          )}
        </div>
      )}

      {/* Apply button */}
      <div className="pt-2 space-y-1.5">
        <Button onClick={apply} className="w-full" size="lg" disabled={applyLoading}>
          {applyLoading ? (
            <Spinner size={16} className="text-white" />
          ) : applied ? (
            <Check className="h-4 w-4" />
          ) : (
            <Send className="h-4 w-4" />
          )}
          {applied ? "Candidature enregistrée" : "Postuler"}
        </Button>
        {applied && (
          <p className="text-caption text-textSecondary text-center">
            L'offre s'est ouverte dans un nouvel onglet — mettez à jour le statut depuis l'onglet Candidatures.
          </p>
        )}
      </div>

      {error && <p className="text-small text-danger pt-2">{error}</p>}
    </Card>
  );
}

function DocRow({
  icon,
  label,
  docxId,
  pdfId,
}: {
  icon: React.ReactNode;
  label: string;
  docxId: number | null;
  pdfId: number | null;
}) {
  return (
    <div className="flex items-center gap-3 rounded-md p-3 border border-success/30 bg-[rgba(48,209,88,0.05)]">
      <div className="h-9 w-9 rounded-md flex items-center justify-center bg-success/15 text-success shrink-0">
        <Check className="h-5 w-5" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-body font-medium">{label}</p>
        <p className="text-caption text-textSecondary">Word modifiable + PDF</p>
      </div>
      <div className="flex items-center gap-1">
        {docxId && (
          <a
            href={`/api/documents/${docxId}`}
            className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md bg-bg border border-border hover:bg-surfaceHover text-small font-medium"
            title="Télécharger le Word"
          >
            <Download className="h-3.5 w-3.5" /> Word
          </a>
        )}
        {pdfId && (
          <a
            href={`/api/documents/${pdfId}`}
            className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md hover:bg-surfaceHover text-small text-textSecondary"
            title="Télécharger le PDF"
          >
            PDF
          </a>
        )}
      </div>
    </div>
  );
}

function ActionRow({
  icon,
  label,
  subtitle,
  done,
  loading,
  onClick,
  downloadId,
}: {
  icon: React.ReactNode;
  label: string;
  subtitle?: string;
  done: boolean;
  loading: boolean;
  onClick: () => void;
  downloadId: number | null;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-md p-3 border transition-colors",
        done ? "border-success/30 bg-[rgba(48,209,88,0.05)]" : "border-border bg-surface"
      )}
    >
      <div
        className={cn(
          "h-9 w-9 rounded-md flex items-center justify-center shrink-0",
          done ? "bg-success/15 text-success" : "bg-bg text-textSecondary"
        )}
      >
        {loading ? <Spinner size={18} /> : done ? <Check className="h-5 w-5" /> : icon}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-body font-medium">{label}</p>
        {subtitle && <p className="text-caption text-textSecondary">{subtitle}</p>}
      </div>
      <div className="flex items-center gap-1">
        {done && downloadId && (
          <a
            href={`/api/documents/${downloadId}`}
            className="h-8 w-8 inline-flex items-center justify-center rounded-md hover:bg-surfaceHover text-textSecondary"
            title="Télécharger"
          >
            <Download className="h-4 w-4" />
          </a>
        )}
        <Button variant="ghost" size="sm" onClick={onClick} disabled={loading}>
          {done ? "Régénérer" : "Générer"}
        </Button>
      </div>
    </div>
  );
}
