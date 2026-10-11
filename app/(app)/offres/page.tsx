import { offresCounts, parseMinScore, searchOffres } from "@/lib/db/offres";
import { PageHeader } from "@/components/app/page-header";
import { OffresList } from "./list";
import { ScanButton } from "./scan-button";
import { ReviewButton } from "./review-button";
import { FeedbackSummary } from "@/components/app/offer-feedback";

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
      <FeedbackSummary className="-mt-4 mb-6 max-w-[75ch]" />
      <OffresList initialResult={initial} initialVieOnly={vieOnly} initialMinScore={minScore} />
    </>
  );
}
