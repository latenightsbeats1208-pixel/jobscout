import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowUpRight, AlertTriangle, CalendarDays, MapPin } from "lucide-react";
import { getOffre, type OffreFiltered } from "@/lib/db/offres";
import { listDocuments, offreFolderPath } from "@/lib/db/documents";
import { getDb } from "@/lib/db";
import { Badge } from "@/components/ui/badge";
import { DescriptionRenderer } from "@/components/app/description-renderer";
import { ActionsPanel } from "./actions";
import { OfferFeedbackControl } from "@/components/app/offer-feedback";
import { getFeedback } from "@/lib/db/feedback";
import { formatRelativeDate, scoreColor } from "@/lib/utils";
import { CONTRACT_LABELS } from "@/lib/contracts";
import { SOURCES_META } from "@/lib/sources-meta";

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
  const existingApplication = getDb().prepare("SELECT status FROM candidatures WHERE offre_id = ? LIMIT 1").get(offre.id) as { status: string } | undefined;
  const score = scoreColor(offre.score ?? 0);
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
          {(offre.location || offre.country) && <span className="inline-flex items-center gap-1.5"><MapPin className="h-4 w-4" /> {offre.location ?? offre.country}{offre.location && offre.country && offre.location !== offre.country ? `, ${offre.country}` : ""}</span>}
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
          <section aria-label="Votre avis" className="glass-panel p-5">
            <OfferFeedbackControl offerId={offre.id} initial={getFeedback(offre.id)} />
          </section>
          {offre.score_breakdown && (
            <section aria-labelledby="score-title" className="glass-panel p-5">
              <h2 id="score-title" className="text-h3">Pourquoi ce score ?</h2>
              <p className="mt-1 text-small text-textSecondary">Comparaison de l'offre avec votre profil.</p>
              {offre.score_breakdown.excluded && (
                <p className="mt-4 rounded-lg border border-border bg-surface px-3 py-2 text-small">
                  <span className="font-semibold">Hors critères</span> — {offre.score_breakdown.excluded}.
                </p>
              )}
              <div className="mt-5 space-y-4">
                {offre.score_breakdown.title != null && <ScoreBar label="Intitulé" value={offre.score_breakdown.title} />}
                <ScoreBar label="Compétences" value={offre.score_breakdown.skills} />
                {offre.score_breakdown.seniority != null && <ScoreBar label="Expérience" value={offre.score_breakdown.seniority} />}
                {/* Les notes calculées avant l'intitulé appelaient ce critère « Secteur ». */}
                <ScoreBar label={offre.score_breakdown.title != null ? "Mots-clés" : "Secteur"} value={offre.score_breakdown.sector} />
                <ScoreBar label="Pays" value={offre.score_breakdown.country} />
                {offre.score_breakdown.language != null && <ScoreBar label="Langue" value={offre.score_breakdown.language} />}
                {offre.score_breakdown.contract != null && <ScoreBar label="Contrat" value={offre.score_breakdown.contract} />}
                {offre.score_breakdown.duration != null && offre.score_breakdown.duration > 0 && <ScoreBar label="Durée V.I.E" value={offre.score_breakdown.duration} />}
              </div>
              {offre.score_breakdown.reason && <p className="mt-5 border-t border-border pt-4 text-small text-textSecondary">{offre.score_breakdown.reason}</p>}
            </section>
          )}
          {offre.ai_review && offre.score_breakdown?.ai_verdict && <AiReviewPanel review={offre.ai_review} />}
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
              {offre.quality_issues?.some((i) => i === "description_sans_rapport" || i === "page_de_resultats") ? (
                <div><p className="font-semibold">Description erronée</p><p className="mt-1 text-small text-textSecondary">Le texte récupéré {offre.quality_issues.includes("page_de_resultats") ? "est celui d'une page de résultats" : "ne parle pas de ce poste"} : il n'est ni affiché, ni pris en compte dans la note. Consultez l'annonce d'origine.</p></div>
              ) : (
                <div><p className="font-semibold">Description indisponible</p><p className="mt-1 text-small text-textSecondary">Consultez l'annonce d'origine ou relancez un scan pour essayer de la récupérer.</p></div>
              )}
            </div>
          ) : (
            <>
              {offre.description_status === "partial" && (
                <p className="mb-3 text-small text-textSecondary">Seul un extrait de l&apos;annonce a été récupéré : la note s&apos;appuie sur peu d&apos;éléments. L&apos;annonce d&apos;origine dit tout.</p>
              )}
              <div className="glass-panel p-5 sm:p-7"><DescriptionRenderer html={offre.description_html} /></div>
            </>
          )}
        </article>
      </div>
    </div>
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

const VERDICT_LABEL: Record<string, string> = {
  postuler: "Vous pouvez postuler",
  a_tenter: "À tenter",
  hors_profil: "Hors de votre profil",
};
const KIND_LABEL: Record<string, string> = { diplome: "diplôme", experience: "expérience", langue: "langue", administratif: "condition administrative" };
const COVERAGE_MARK: Record<string, { mark: string; label: string; className: string }> = {
  oui: { mark: "✓", label: "couvert", className: "text-success" },
  partiel: { mark: "≈", label: "partiellement couvert", className: "text-textSecondary" },
  non: { mark: "✗", label: "non couvert", className: "text-danger" },
};

/** Exigences indispensables relevées par l'IA, et ce que le profil en couvre. */
function AiReviewPanel({ review }: { review: NonNullable<OffreFiltered["ai_review"]> }) {
  return (
    <section aria-labelledby="ai-review-title" className="glass-panel p-5">
      <h2 id="ai-review-title" className="text-h3">Relecture par l&apos;IA</h2>
      <p className="mt-1 text-small text-textSecondary">
        {VERDICT_LABEL[review.verdict] ?? review.verdict} · {review.skills_fit} % des compétences indispensables couvertes
      </p>
      {review.must_haves.length > 0 && (
        <ul className="mt-4 space-y-2">
          {review.must_haves.map((m) => {
            const c = COVERAGE_MARK[m.covered];
            return (
              <li key={m.requirement} className="flex items-start gap-2 text-small">
                <span aria-hidden="true" className={`w-4 shrink-0 font-semibold ${c.className}`}>{c.mark}</span>
                <span>
                  {m.requirement}
                  {/* Diplômes, années, langues, conditions administratives : affichés, mais seules les compétences filtrent. */}
                  {m.kind && m.kind !== "competence" && <span className="text-textSecondary"> · {KIND_LABEL[m.kind]}</span>}
                  {m.verified === false && <span className="text-textSecondary"> · déduite, ne compte pas</span>}
                  <span className="sr-only"> : {c.label}</span>
                  {m.verified && m.citation && <span className="mt-0.5 block text-caption text-textSecondary">« {m.citation} »</span>}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {review.reason && <p className="mt-4 border-t border-border pt-4 text-small text-textSecondary">{review.reason}</p>}
    </section>
  );
}
