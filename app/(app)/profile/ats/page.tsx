import { PageHeader } from "@/components/app/page-header";
import { AtsAnalyzer } from "./ats-analyzer";
import { getProfile } from "@/lib/db/queries";
import { scoreAts } from "@/lib/ats/score";

export const dynamic = "force-dynamic";

export default function AtsPage() {
  const profile = getProfile();
  const initialScore = profile?.raw_cv_text?.trim() ? scoreAts(profile.raw_cv_text) : null;

  return (
    <>
      <PageHeader
        eyebrow="Votre espace"
        title="Analyse ATS du CV"
        subtitle="Notez la lisibilité de votre CV par les logiciels de tri de candidatures (ATS) et recevez des améliorations concrètes. Analyse 100 % locale, instantanée et gratuite."
      />
      <AtsAnalyzer
        initialResult={initialScore}
        initialFilename={initialScore ? "CV importé sur votre profil" : null}
      />
    </>
  );
}
