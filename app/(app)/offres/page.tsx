import { listOffres, offresCounts } from "@/lib/db/offres";
import { PageHeader } from "@/components/app/page-header";
import { OffresList } from "./list";
import { ScanButton } from "./scan-button";

export const dynamic = "force-dynamic";

export default async function OffresPage() {
  const offres = listOffres();
  const counts = offresCounts();

  return (
    <>
      <PageHeader
        title="Offres"
        subtitle={`${counts.total} offres · ${counts.today} aujourd'hui · ${counts.vie} V.I.E`}
        actions={<ScanButton />}
      />
      <OffresList initial={offres} />
    </>
  );
}
