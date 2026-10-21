import { listCandidatures, candidaturesCounts } from "@/lib/db/candidatures";
import { PageHeader } from "@/components/app/page-header";
import { CandidaturesTable } from "./table";

export const dynamic = "force-dynamic";

export default async function CandidaturesPage() {
  const items = listCandidatures();
  const { upcoming } = candidaturesCounts();
  const inProgress = items.filter((item) => item.status === "en_cours").length;
  // Sous-titre chiffré (comme en 3.4.10) plutôt qu'un slogan.
  const subtitle = items.length
    ? `${items.length} candidature${items.length > 1 ? "s" : ""} · ${inProgress} en préparation · ${upcoming ? `${upcoming} rappel${upcoming > 1 ? "s" : ""} ou échéance${upcoming > 1 ? "s" : ""} à venir` : "aucun rappel ou échéance à venir"}`
    : "Aucune candidature suivie pour l'instant.";
  return (
    <>
      <PageHeader eyebrow="Faire avancer" title="Candidatures" subtitle={subtitle} />
      <CandidaturesTable initial={items} />
    </>
  );
}
