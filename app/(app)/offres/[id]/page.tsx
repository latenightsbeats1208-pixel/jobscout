import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ExternalLink, AlertTriangle, Calendar, MapPin, Building2 } from "lucide-react";
import { getOffre } from "@/lib/db/offres";
import { listDocuments, offreFolderPath } from "@/lib/db/documents";
import { Badge } from "@/components/ui/badge";
import { DescriptionRenderer } from "@/components/app/description-renderer";
import { ActionsPanel } from "./actions";
import { formatRelativeDate, scoreColor } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function OffreDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const offre = getOffre(Number(id));
  if (!offre) notFound();

  const docs = listDocuments({ offreId: offre.id });
  const cvPdf = docs.find((d) => d.type === "cv" && d.format === "pdf") ?? null;
  const cvDocx = docs.find((d) => d.type === "cv" && d.format === "docx") ?? null;
  const lmPdf = docs.find((d) => d.type === "lm" && d.format === "pdf") ?? null;
  const lmDocx = docs.find((d) => d.type === "lm" && d.format === "docx") ?? null;
  const msgDoc = docs.find((d) => d.type === "msg") ?? null;
  const sc = scoreColor(offre.score ?? 0);
  const isFailed = offre.description_status === "failed";

  return (
    <div>
      <Link
        href="/offres"
        className="inline-flex items-center gap-1.5 text-small text-textSecondary hover:text-text mb-6"
      >
        <ArrowLeft className="h-4 w-4" /> Retour aux offres
      </Link>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-10">
        <div>
          <div className="flex items-start gap-3 mb-3">
            <span
              className="shrink-0 inline-flex items-center justify-center rounded-full px-3 h-8 text-body font-semibold"
              style={{ background: sc.bg, color: sc.fg }}
            >
              {offre.score ?? 0}
            </span>
            <h1 className="text-h1 tracking-tight flex-1">{offre.title}</h1>
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-body text-textSecondary mb-4">
            <span className="inline-flex items-center gap-1.5">
              <Building2 className="h-4 w-4" /> {offre.company}
            </span>
            {offre.location && (
              <span className="inline-flex items-center gap-1.5">
                <MapPin className="h-4 w-4" />
                {offre.location}
                {offre.country ? `, ${offre.country}` : ""}
              </span>
            )}
            {offre.posted_at && (
              <span className="inline-flex items-center gap-1.5">
                <Calendar className="h-4 w-4" /> {formatRelativeDate(offre.posted_at)}
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2 mb-8">
            <Badge variant="default">{offre.source}</Badge>
            {offre.is_vie ? <Badge variant="info">V.I.E</Badge> : null}
            {offre.contract_type && <Badge variant="default">{offre.contract_type}</Badge>}
            <a
              href={offre.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-small text-accent hover:underline ml-auto"
            >
              Source <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </div>

          {offre.score_breakdown && (
            <div className="bg-surface rounded-lg p-4 mb-6">
              <p className="text-caption uppercase tracking-wide text-textSecondary mb-2">
                Détail du score
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-2">
                <ScoreBar label="Secteur" value={offre.score_breakdown.sector} />
                <ScoreBar label="Compétences" value={offre.score_breakdown.skills} />
                <ScoreBar label="Pays" value={offre.score_breakdown.country} />
                {offre.score_breakdown.language != null && (
                  <ScoreBar label="Langue" value={offre.score_breakdown.language} />
                )}
                {offre.score_breakdown.contract != null && (
                  <ScoreBar label="Contrat" value={offre.score_breakdown.contract} />
                )}
                {offre.score_breakdown.duration != null &&
                  offre.score_breakdown.duration > 0 && (
                    <ScoreBar label="Durée V.I.E" value={offre.score_breakdown.duration} />
                  )}
              </div>
              {offre.score_breakdown.reason && (
                <p className="text-small text-textSecondary mt-2">{offre.score_breakdown.reason}</p>
              )}
            </div>
          )}

          {isFailed ? (
            <div className="flex items-start gap-3 p-5 rounded-lg bg-[rgba(255,159,10,0.08)] text-[#c97400]">
              <AlertTriangle className="h-5 w-5 mt-0.5 shrink-0" />
              <div>
                <p className="font-semibold">Description non récupérée</p>
                <p className="text-small mt-1">
                  Le scrapping de cette offre a échoué. Cliquez sur le lien source ci-dessus pour la consulter
                  directement, ou relancez un scan.
                </p>
              </div>
            </div>
          ) : (
            <DescriptionRenderer html={offre.description_html} />
          )}
        </div>

        <aside className="lg:sticky lg:top-12 self-start space-y-3">
          <ActionsPanel
            offreId={offre.id}
            offreUrl={offre.url}
            isVie={!!offre.is_vie}
            initial={{
              cv_pdf_id: cvPdf?.id ?? null,
              cv_docx_id: cvDocx?.id ?? null,
              lm_pdf_id: lmPdf?.id ?? null,
              lm_docx_id: lmDocx?.id ?? null,
              msg_id: msgDoc?.id ?? null,
            }}
            initialFolder={
              docs.length > 0 ? offreFolderPath(offre.id, offre.company, offre.title) : null
            }
          />
        </aside>
      </div>
    </div>
  );
}

function ScoreBar({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="flex justify-between text-caption text-textSecondary mb-1">
        <span>{label}</span>
        <span>{Math.round(value)}</span>
      </div>
      <div className="h-1 bg-bg rounded-full overflow-hidden">
        <div
          className="h-full bg-accent transition-all duration-500"
          style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
        />
      </div>
    </div>
  );
}
