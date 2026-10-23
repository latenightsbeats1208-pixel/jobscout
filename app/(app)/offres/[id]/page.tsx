import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowUpRight, AlertTriangle, CalendarDays, MapPin } from "lucide-react";
import { getOffre } from "@/lib/db/offres";
import { offerDistanceText } from "@/lib/distance/home";
import { listDocuments, offreFolderPath } from "@/lib/db/documents";
import { getDb } from "@/lib/db";
import { Badge } from "@/components/ui/badge";
import { DescriptionRenderer } from "@/components/app/description-renderer";
import { ActionsPanel } from "./actions";
import { InterviewPrepPanel } from "./interview-prep";
import { formatRelativeDate, scoreColor } from "@/lib/utils";
import { CONTRACT_LABELS } from "@/lib/contracts";
import { SOURCES_META } from "@/lib/sources-meta";
import { getProfile } from "@/lib/db/queries";
import { scoreAts } from "@/lib/ats/score";

export const dynamic = "force-dynamic";

export default async function OffreDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const offre = getOffre(Number(id));
  if (!offre) notFound();
  const profile = getProfile();
  const atsScore = profile?.raw_cv_text?.trim() ? scoreAts(profile.raw_cv_text, offre.title) : null;

  const docs = listDocuments({ offreId: offre.id });
  const cvPdf = docs.find((d) => d.type === "cv" && d.format === "pdf") ?? null;
  const cvDocx = docs.find((d) => d.type === "cv" && d.format === "docx") ?? null;
  const lmPdf = docs.find((d) => d.type === "lm" && d.format === "pdf") ?? null;
  const lmDocx = docs.find((d) => d.type === "lm" && d.format === "docx") ?? null;
  const msgDoc = docs.find((d) => d.type === "msg") ?? null;
  const existingApplication = getDb().prepare("SELECT status FROM candidatures WHERE offre_id = ? LIMIT 1").get(offre.id) as { status: string } | undefined;
  const score = scoreColor(offre.score ?? 0);
  const distance = offerDistanceText(offre);
  const sourceLabel = SOURCES_META.find((source) => source.id === offre.source)?.label ?? offre.source;
  const contractLabel = offre.contract_category !== "autre" ? CONTRACT_LABELS[offre.contract_category] : null;
  // Le libellé brut de la source n'est répété que s'il apporte une précision (« Temps plein »…).
  const rawContract = offre.contract_type && offre.contract_type.trim().toLowerCase() !== contractLabel?.toLowerCase() ? offre.contract_type : null;

  return (
    <div>
      <Link href="/offres" className="mb-6 inline-flex items-center gap-2 text-small font-semibold text-textSecondary transition-colors hover:text-accent">
        <ArrowLeft className="h-4 w-4" /> Toutes les offres
      </Link>

      <header className="glass-panel focus-card mb-8 p-5 sm:mb-9 sm:p-7">
        <div className="flex items-start gap-4">
          <div className="min-w-0 flex-1">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-accent">{offre.company || "Entreprise non précisée"}</p>
            <h1 className="font-display text-h1 text-balance">{offre.title}</h1>
          </div>
          <div className="score-badge flex h-16 w-16 shrink-0 flex-col items-center justify-center rounded-lg sm:h-[76px] sm:w-[76px]" data-tone={score.tone} aria-label={`Adéquation ${offre.score ?? 0} sur 100, ${score.label.toLowerCase()}`}>
            <span className="text-[26px] font-bold leading-none tabular-nums sm:text-[30px]">{offre.score ?? 0}</span>
            <span className="mt-1 text-[11px] font-semibold uppercase tracking-wide">/ 100</span>
          </div>
        </div>
        <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 text-small text-textSecondary">
          {(offre.location || offre.country) && (
            <span className="inline-flex items-start gap-1.5">
              <MapPin className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{offre.location ?? offre.country}{offre.location && offre.country && offre.location !== offre.country ? `, ${offre.country}` : ""}{distance && (
                <>
                  {" · "}<span className="whitespace-nowrap font-semibold text-text">{distance.label}</span>
                  {distance.from && <>{" "}<span className="whitespace-nowrap font-semibold text-text">{distance.from}</span></>}
                  {distance.place && <>{" "}(lieu compris : <span className="whitespace-nowrap">{distance.place}</span>)</>}
                </>
              )}</span>
            </span>
          )}
          {offre.posted_at && <span className="inline-flex items-center gap-1.5"><CalendarDays className="h-4 w-4" /> {formatRelativeDate(offre.posted_at)}</span>}
          <span className="font-medium">Score {score.label.toLowerCase()}</span>
        </div>
        <div className="mt-5 flex flex-wrap items-center gap-2">
          <Badge>{sourceLabel}</Badge>
          {contractLabel && <Badge variant={offre.contract_category === "vie" ? "info" : "default"}>{contractLabel}</Badge>}
          {rawContract && <Badge>{rawContract}</Badge>}
          <a href={offre.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-small font-semibold text-accent hover:underline sm:ml-auto">
            Voir l'annonce d'origine <ArrowUpRight className="h-4 w-4" />
          </a>
        </div>
      </header>

      <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_340px] xl:gap-7">
        <aside className="order-1 space-y-5 xl:order-2 xl:sticky xl:top-8 xl:self-start">
          <ActionsPanel
            offreId={offre.id}
            offreUrl={offre.url}
            isVie={offre.contract_category === "vie"}
            initial={{ cv_pdf_id: cvPdf?.id ?? null, cv_docx_id: cvDocx?.id ?? null, lm_pdf_id: lmPdf?.id ?? null, lm_docx_id: lmDocx?.id ?? null, msg_id: msgDoc?.id ?? null }}
            initialTrackingStatus={existingApplication?.status ?? null}
            initialFolder={docs.length > 0 ? offreFolderPath(offre.id, offre.company, offre.title) : null}
          />
          {offre.score_breakdown && (
            <section aria-labelledby="score-title" className="glass-panel p-5">
              <h2 id="score-title" className="text-h3">Pourquoi ce score ?</h2>
              <p className="mt-1 text-small text-textSecondary">Comparaison de l'offre avec votre profil.</p>
              <div className="mt-5 space-y-4">
                <ScoreBar label="Secteur" value={offre.score_breakdown.sector} />
                <ScoreBar label="Compétences" value={offre.score_breakdown.skills} />
                <ScoreBar label="Pays" value={offre.score_breakdown.country} />
                {offre.score_breakdown.language != null && <ScoreBar label="Langue" value={offre.score_breakdown.language} />}
                {offre.score_breakdown.contract != null && <ScoreBar label="Contrat" value={offre.score_breakdown.contract} />}
                {offre.score_breakdown.duration != null && offre.score_breakdown.duration > 0 && <ScoreBar label="Durée V.I.E" value={offre.score_breakdown.duration} />}
              </div>
              {offre.score_breakdown.reason && <p className="mt-5 border-t border-border pt-4 text-small text-textSecondary">{offre.score_breakdown.reason}</p>}
              {((offre.score_breakdown.matched_sectors?.length ?? 0) > 0 || (offre.score_breakdown.matched_skills?.length ?? 0) > 0) && (
                <div className="mt-4 space-y-3 border-t border-border pt-4">
                  <div>
                    <p className="text-caption font-semibold uppercase tracking-wide text-textSecondary">Correspondances détectées</p>
                    <p className="mt-1 text-small text-text">
                      {[...(offre.score_breakdown.matched_sectors ?? []), ...(offre.score_breakdown.matched_skills ?? [])].join(" · ")}
                    </p>
                  </div>
                  {(offre.score_breakdown.profile_skills_not_in_offer?.length ?? 0) > 0 && (
                    <div>
                      <p className="text-caption font-semibold uppercase tracking-wide text-textSecondary">Compétences du profil non mentionnées dans l’annonce</p>
                      <p className="mt-1 text-small text-textSecondary">{offre.score_breakdown.profile_skills_not_in_offer?.join(" · ")}</p>
                      <p className="mt-1 text-caption text-textSecondary">Cela ne signifie pas qu’elles sont requises ni qu’il vous manque une compétence.</p>
                    </div>
                  )}
                </div>
              )}
            </section>
          )}
          {atsScore && <OfferAtsCard score={atsScore} targetTitle={offre.title} />}
        </aside>

        <article className="order-2 min-w-0 xl:order-1">
          <div className="mb-5 flex items-center justify-between gap-3">
            <div>
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.15em] text-textSecondary">L'annonce</p>
              <h2 className="font-display text-h2">À propos du poste</h2>
            </div>
          </div>
          {offre.description_status === "failed" ? (
            <div className="glass-panel flex items-start gap-3 p-5">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-warning" />
              <div><p className="font-semibold">Description indisponible</p><p className="mt-1 text-small text-textSecondary">Consultez l'annonce d'origine ou relancez un scan pour essayer de la récupérer.</p></div>
            </div>
          ) : (
            <div className="glass-panel p-5 sm:p-7"><DescriptionRenderer html={offre.description_html} /></div>
          )}
          <div className="mt-6">
            <InterviewPrepPanel offreId={offre.id} />
          </div>
        </article>
      </div>
    </div>
  );
}

function OfferAtsCard({ score, targetTitle }: { score: ReturnType<typeof scoreAts>; targetTitle: string }) {
  const grade = {
    excellent: { label: "Excellent", variant: "success" as const },
    bon: { label: "Bon", variant: "info" as const },
    moyen: { label: "Moyen", variant: "warning" as const },
    faible: { label: "Faible", variant: "danger" as const },
  }[score.grade];
  const percent = score.max > 0 ? Math.round((score.score / score.max) * 100) : 0;
  return (
    <section aria-labelledby="ats-offer-title" className="glass-panel p-5">
      <div className="flex items-center justify-between gap-2">
        <h2 id="ats-offer-title" className="text-h3">Score ATS pour cette offre</h2>
        <Badge variant={grade.variant}>{grade.label}</Badge>
      </div>
      <p className="mt-2 font-display text-[32px] font-semibold tabular-nums">{percent}<span className="text-h3 text-textSecondary">/100</span></p>
      <p className="mt-1 text-small text-textSecondary">Comparaison locale de votre CV importé avec le poste « {targetTitle} ».</p>
      {score.suggestions.length > 0 ? (
        <ul className="mt-4 space-y-2 border-t border-border pt-4">
          {score.suggestions.slice(0, 3).map((item) => (
            <li key={item.criterion} className="text-small">
              <span className="font-medium">{item.issue}.</span>
              <span className="text-textSecondary"> {item.fix}</span>
            </li>
          ))}
        </ul>
      ) : <p className="mt-3 text-small text-textSecondary">Aucune amélioration prioritaire détectée selon ce barème.</p>}
      <p className="mt-3 text-caption text-textSecondary">Ce score indicatif n’est pas une prédiction de sélection par un ATS.</p>
    </section>
  );
}

function ScoreBar({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="mb-1.5 flex justify-between gap-3 text-small"><span className="text-textSecondary">{label}</span><span className="font-semibold tabular-nums">{Math.round(value)}</span></div>
      <div className="h-1.5 overflow-hidden rounded-full bg-surfaceHover"><div className="h-full rounded-full bg-accent" style={{ width: `${Math.max(0, Math.min(100, value))}%` }} /></div>
    </div>
  );
}
