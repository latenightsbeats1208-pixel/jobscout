import { listCandidatures } from "@/lib/db/candidatures";
import { PageHeader } from "@/components/app/page-header";
import { CandidaturesTable } from "./table";

export const dynamic = "force-dynamic";

export default async function CandidaturesPage() {
  const items = listCandidatures();
  return (
    <>
      <PageHeader
        title="Candidatures"
        subtitle={`${items.length} candidature${items.length > 1 ? "s" : ""}`}
      />
      <CandidaturesTable initial={items} />
    </>
  );
}
