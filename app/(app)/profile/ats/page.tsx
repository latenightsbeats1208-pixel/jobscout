import { PageHeader } from "@/components/app/page-header";
import { AtsAnalyzer } from "./ats-analyzer";

export default function AtsPage() {
  return (
    <>
      <PageHeader
        eyebrow="Votre espace"
        title="Analyse ATS du CV"
        subtitle="Notez la lisibilité de votre CV par les logiciels de tri de candidatures (ATS) et recevez des améliorations concrètes. Analyse 100 % locale, instantanée et gratuite."
      />
      <AtsAnalyzer />
    </>
  );
}
