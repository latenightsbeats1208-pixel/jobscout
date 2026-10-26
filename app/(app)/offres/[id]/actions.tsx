"use client";
import { useState } from "react";
import Link from "next/link";
import { Check, FileText, Mail, MessageSquare, Download, Sparkles, FolderOpen, ArrowUpRight, BookmarkPlus, Send, AlertTriangle, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

/** Résumé renvoyé par /api/generate/* quand le CV vient du modèle maître. */
type TemplateInfo = { cluster: string; clusterName: string; headline: string; mode: string; warnings: string[] };

type DocsState = {
  cv_pdf_id: number | null;
  cv_docx_id: number | null;
  lm_pdf_id: number | null;
  lm_docx_id: number | null;
  msg_id: number | null;
};

// Mêmes libellés que la page Candidatures.
const STATUS_LABELS: Record<string, string> = {
  envoyee: "Envoyée",
  en_cours: "En cours",
  entretien: "Entretien",
  acceptee: "Acceptée",
  refusee: "Refusée",
};

// Les messages d'erreur IA renvoient à « Profil › Génération IA » : on y mène d'un clic.
const AI_SETTINGS_HINT = /Génération IA/;

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
  initialTrackingStatus = null,
  initialFolder = null,
  canOpenFolder = true,
  templateCluster = null,
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
  initialTrackingStatus?: string | null;
  initialFolder?: string | null;
  /** Faux sur un serveur distant : pas d'explorateur de fichiers à ouvrir. */
  canOpenFolder?: boolean;
  /** Cluster probable (choix automatique) quand un modèle de CV existe. */
  templateCluster?: { id: string; name: string } | null;
}) {
  const [docs, setDocs] = useState<DocsState>(initial);
  const [allLoading, setAllLoading] = useState(false);
  const [msgLoading, setMsgLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [msgPreview, setMsgPreview] = useState<{ text: string; length: number } | null>(null);
  const [trackLoading, setTrackLoading] = useState(false);
  const [applyLoading, setApplyLoading] = useState(false);
  const [justApplied, setJustApplied] = useState(false);
  const [trackingStatus, setTrackingStatus] = useState<string | null>(initialTrackingStatus);
  const [folder, setFolder] = useState<string | null>(initialFolder);
  const [templateInfo, setTemplateInfo] = useState<TemplateInfo | null>(null);

  // Un document existe dès qu'un de ses deux formats est enregistré : sur un
  // échec survenu entre l'écriture du PDF et celle du DOCX, la ligne doit
  // quand même apparaître avec le seul lien réellement disponible.
  const hasCV = !!(docs.cv_docx_id || docs.cv_pdf_id);
  const hasLM = !!(docs.lm_docx_id || docs.lm_pdf_id);
  const docsReady = hasCV && hasLM;
  // « Postuler » reste proposé tant que la candidature n'est pas partie (absente ou « En cours »).
  const applied = !!trackingStatus && trackingStatus !== "en_cours";
  const busy = applyLoading || trackLoading;

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
        if (data?.template) setTemplateInfo(data.template);
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
      setTemplateInfo(data.template ?? null);
      setDocs((d) => ({
        ...d,
        cv_pdf_id: data.cv.pdfId,
        cv_docx_id: data.cv.docxId,
        lm_pdf_id: data.lm.pdfId,
        lm_docx_id: data.lm.docxId,
      }));
      if (data.folder) {
        setFolder(data.folder);
        if (canOpenFolder) openFolder(data.folder);
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
        if (canOpenFolder) openFolder(data.folder);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur réseau");
    } finally {
      setMsgLoading(false);
    }
  }

  // Geste unique de la 3.4.10 : ouvrir l'annonce ET enregistrer la candidature « Envoyée ».
  async function apply() {
    if (!/^https?:\/\//i.test(offreUrl)) {
      setError("Le lien de l'annonce est invalide : retrouvez-la sur le site d'origine.");
      return;
    }
    // Ouverture synchrone, dans le geste de l'utilisateur : sinon le navigateur la bloque.
    window.open(offreUrl, "_blank", "noopener,noreferrer");
    setApplyLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/candidatures", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          offre_id: offreId,
          cv_doc_id: docs.cv_docx_id ?? docs.cv_pdf_id,
          lm_doc_id: docs.lm_docx_id ?? docs.lm_pdf_id,
          msg_doc_id: docs.msg_id,
          status: "envoyee",
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.id) {
        setError(data?.error || "L'annonce est ouverte, mais la candidature n'a pas pu être enregistrée.");
        return;
      }
      // Déjà « En cours » dans le suivi : la création dédoublonnée garde l'ancien
      // statut, on le fait donc passer explicitement à « Envoyée ».
      if (trackingStatus === "en_cours") {
        const patch = await fetch("/api/candidatures", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id: data.id, status: "envoyee" }),
        });
        if (!patch.ok) {
          setError("L'annonce est ouverte, mais le statut n'a pas pu passer à « Envoyée » : changez-le depuis Candidatures.");
          return;
        }
      }
      setTrackingStatus("envoyee");
      setJustApplied(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur réseau");
    } finally {
      setApplyLoading(false);
    }
  }

  async function addToTracking() {
    setTrackLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/candidatures", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          offre_id: offreId,
          cv_doc_id: docs.cv_docx_id ?? docs.cv_pdf_id,
          lm_doc_id: docs.lm_docx_id ?? docs.lm_pdf_id,
          msg_doc_id: docs.msg_id,
          status: "en_cours",
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "La candidature n'a pas pu être enregistrée.");
        return;
      }
      setTrackingStatus("en_cours");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur réseau");
    } finally {
      setTrackLoading(false);
    }
  }

  return (
    <Card className="space-y-4 p-5">
      <div>
        <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.15em] text-accent">Préparer votre dossier</p>
        <h3 className="font-display text-h3 mb-1">Passez à l'action</h3>
        <p className="text-small text-textSecondary">
          Préparez vos documents, puis finalisez la candidature sur le site de l'annonce.
        </p>
      </div>

      {/* Un seul bouton principal à la fois : générer tant que le dossier est
          incomplet, puis postuler. */}
      <Button
        onClick={generateAll}
        size="lg"
        variant={docsReady ? "secondary" : "primary"}
        className="w-full"
        disabled={allLoading}
      >
        {allLoading ? <Spinner size={16} className="text-current" /> : <Sparkles className="h-4 w-4" />}
        {allLoading
          ? "Génération en cours…"
          : docsReady
          ? "Régénérer les documents"
          : "Générer les documents"}
      </Button>

      {templateCluster && !templateInfo && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-surface px-3 py-2 text-small">
          <span className="text-textSecondary">
            Modèle CV : cluster probable <span className="font-semibold text-text">{templateCluster.id}</span> · {templateCluster.name}
          </span>
          <a href={`/api/cv-template/preview?offreId=${offreId}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-accent hover:underline">
            <Eye className="h-3.5 w-3.5" /> Aperçu
          </a>
        </div>
      )}

      {templateInfo && (
        <div className="space-y-2 rounded-md border border-border bg-surface px-3 py-2.5 text-small">
          <p className="text-textSecondary">
            CV assemblé depuis votre modèle : cluster <span className="font-semibold text-text">{templateInfo.cluster}</span> · {templateInfo.clusterName}
            {templateInfo.mode === "ai" ? " (choisi par l'IA)" : " (choix automatique)"}. Titre : « {templateInfo.headline} ».
          </p>
          {templateInfo.warnings.length > 0 && (
            <ul className="space-y-1">
              {templateInfo.warnings.map((w, i) => (
                <li key={i} className="flex items-start gap-1.5 text-text">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" aria-hidden="true" /> {w}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

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
          {folder && canOpenFolder && (
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

      <div className="space-y-2 border-t border-border pt-4">
        {applied ? (
          <Button asChild variant="secondary" className="w-full" size="md">
            <a href={offreUrl} target="_blank" rel="noopener noreferrer">
              Revoir l'annonce <ArrowUpRight className="h-4 w-4" />
            </a>
          </Button>
        ) : (
          <Button onClick={apply} variant={docsReady ? "primary" : "secondary"} className="w-full" size="lg" disabled={busy}>
            {applyLoading ? <Spinner size={16} className="text-current" /> : <Send className="h-4 w-4" />}
            Postuler
          </Button>
        )}
        {trackingStatus ? (
          <div role="status" className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border border-success/30 bg-success/[.06] px-3 py-2.5 text-small">
            <Check className="h-4 w-4 shrink-0 text-success" />
            <span><span className="font-semibold">Dans votre suivi</span> · {STATUS_LABELS[trackingStatus] ?? trackingStatus}</span>
            <Link href="/candidatures" className="ml-auto font-semibold text-accent hover:underline">Candidatures</Link>
          </div>
        ) : (
          <Button onClick={addToTracking} className="w-full" size="md" variant="ghost" disabled={busy}>
            {trackLoading ? <Spinner size={16} /> : <BookmarkPlus className="h-4 w-4" />}
            Ajouter au suivi
          </Button>
        )}
        <p className="text-caption text-textSecondary">
          {justApplied
            ? "L'annonce s'est ouverte dans un nouvel onglet et la candidature est enregistrée « Envoyée »."
            : applied
            ? "Mettez son statut à jour depuis Candidatures (entretien, réponse…)."
            : trackingStatus === "en_cours"
            ? "« Postuler » ouvre l'annonce et fait passer la candidature à « Envoyée »."
            : "« Postuler » ouvre l'annonce et enregistre la candidature « Envoyée ». « Ajouter au suivi » la garde « En cours » le temps de préparer le dossier."}
        </p>
      </div>

      {error && (
        <p role="alert" className="pt-2 text-small text-danger">
          {error}
          {AI_SETTINGS_HINT.test(error) && (
            <>
              {" "}
              <Link href="/profile#parametres" className="font-semibold underline">Ouvrir les réglages IA</Link>
            </>
          )}
        </p>
      )}
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
