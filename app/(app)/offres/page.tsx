import { offresCounts, parseMinScore, previousSearchOffres, searchOffres } from "@/lib/db/offres";
import { PageHeader } from "@/components/app/page-header";
import { OffresList } from "./list";
import { ScanButton } from "./scan-button";
import { ReviewButton } from "./review-button";
import { PreviousSearchNotice } from "./previous-search-notice";
import { FeedbackSummary } from "@/components/app/offer-feedback";
import { lastFinishedScan, type LastScan } from "@/lib/db/scans";
import { sourceLabel } from "@/lib/sources-meta";
import { fromSqliteUtc } from "@/lib/utils";
import { AlertTriangle } from "lucide-react";

export const dynamic = "force-dynamic";

const numberFormat = new Intl.NumberFormat("fr-FR");

function plural(count: number, word: string): string {
  return `${numberFormat.format(count)} ${word}${count > 1 ? "s" : ""}`;
}

export default async function OffresPage({ searchParams }: { searchParams: Promise<{ vie?: string; score?: string }> }) {
  const { vie, score } = await searchParams;
  const vieOnly = vie === "1";
  // ?score=70 (carte « Offres à 70 et plus » de l'accueil) active la puce de score à ce seuil.
  const minScore = parseMinScore(score);
  // Même requête que celle de la liste côté navigateur : ?vie=1 coche la puce contrat « V.I.E ».
  const initial = searchOffres({ contracts: vieOnly ? ["vie"] : [], minScore });
  // Total et V.I.E lus dans les facettes (sans le filtre de score, pour décrire la base) : mêmes chiffres que la liste et la puce « V.I.E ».
  const { total, contractCounts } = initial.facets;
  const previous = previousSearchOffres();
  const subtitle = [
    plural(total, "offre"),
    `${numberFormat.format(offresCounts().today)} aujourd'hui`,
    ...(contractCounts.vie > 0 ? [`${numberFormat.format(contractCounts.vie)} V.I.E`] : []),
  ].join(" · ");

  return (
    <>
      <PageHeader
        eyebrow="Découvrir"
        title="Vos prochaines opportunités"
        subtitle={subtitle}
        actions={<><ReviewButton /><ScanButton /></>}
      />
      <LastScanNotice scan={lastFinishedScan()} />
      {previous && <PreviousSearchNotice {...previous} />}
      <FeedbackSummary className="-mt-4 mb-6 max-w-[75ch]" />
      <OffresList initialResult={initial} initialVieOnly={vieOnly} initialMinScore={minScore} />
    </>
  );
}

/**
 * Rappel tant que le dernier scan est incomplet : la fenêtre du scan se ferme,
 * et une source muette passerait sinon pour une source sans nouvelle offre.
 */
function LastScanNotice({ scan }: { scan: LastScan | null }) {
  if (!scan || scan.status === "done") return null;
  const when = new Date(fromSqliteUtc(scan.finished_at)).toLocaleString("fr-FR", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
  return (
    <div role="status" className="glass-panel -mt-4 mb-6 flex max-w-[75ch] items-start gap-3 p-4">
      <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-warning" />
      <div className="min-w-0 text-small">
        <p className="font-semibold">
          {scan.status === "failed" ? "Le dernier scan n'a rien rapporté" : "Le dernier scan est incomplet"} <span className="font-normal text-textSecondary">({when})</span>
        </p>
        <ul className="mt-1 space-y-1 text-textSecondary">
          {scan.failures.map((f) => (
            <li key={f.source}><span className="font-medium text-text">{sourceLabel(f.source)}</span> : {f.message}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}
