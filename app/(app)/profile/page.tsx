import Link from "next/link";
import { ArrowRight, FilePlus2, Gauge } from "lucide-react";
import { redirect } from "next/navigation";
import { getProfile } from "@/lib/db/queries";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { SettingsFolder } from "@/components/app/settings-folder";
import { AiSettings } from "@/components/app/ai-settings";
import { CleanupButton } from "@/components/app/cleanup-button";
import { ProfileSwitcher } from "@/components/app/profile-switcher";
import { ProfileEditor } from "./profile-editor";
import { scoreAts } from "@/lib/ats/score";
import { Badge } from "@/components/ui/badge";

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const profile = getProfile();
  if (!profile) redirect("/onboarding/upload");
  const atsScore = profile.raw_cv_text?.trim() ? scoreAts(profile.raw_cv_text) : null;
  const atsPercent = atsScore && atsScore.max > 0 ? Math.round((atsScore.score / atsScore.max) * 100) : null;
  const atsGrade = atsScore
    ? {
        excellent: { label: "Excellent", variant: "success" as const },
        bon: { label: "Bon", variant: "info" as const },
        moyen: { label: "Moyen", variant: "warning" as const },
        faible: { label: "Faible", variant: "danger" as const },
      }[atsScore.grade]
    : null;
  // 0 source cochée : le scan se replie sur les sources par défaut (orchestrateur).
  const sources = profile.sources_enabled.length;
  const countries = profile.target_countries.length;
  const sectors = profile.sectors.length;

  return (
    <>
      <PageHeader
        eyebrow="Vous connaître"
        title="Votre profil"
        subtitle={`${sectors} secteur${sectors > 1 ? "s" : ""} · ${countries} pays ciblé${countries > 1 ? "s" : ""} · ${sources ? `${sources} source${sources > 1 ? "s" : ""} de recherche` : "sources par défaut"}. Ces informations guident le classement des offres et vos documents.`}
        actions={
          <>
            <Button asChild variant="primary">
              <Link href="/profile/add-cv"><FilePlus2 className="h-4 w-4" /> Ajouter un CV</Link>
            </Button>
            <Button asChild variant="secondary">
              <Link href="/profile/ats"><Gauge className="h-4 w-4" /> Analyser mon CV (ATS)</Link>
            </Button>
          </>
        }
      />

      <div className="glass-panel mb-8 grid grid-cols-3 divide-x divide-border py-5 text-center sm:py-6">
        <div><p className="font-display text-[27px] font-semibold tabular-nums">{profile.experiences.length}</p><p className="text-small text-textSecondary">Expériences</p></div>
        <div><p className="font-display text-[27px] font-semibold tabular-nums">{profile.educations.length}</p><p className="text-small text-textSecondary">Formations</p></div>
        <div><p className="font-display text-[27px] font-semibold tabular-nums">{profile.skills.length}</p><p className="text-small text-textSecondary">Compétences</p></div>
      </div>

      <section aria-label="Score ATS de votre CV" className="glass-panel mb-8 flex flex-wrap items-center justify-between gap-4 p-5">
        <div>
          <p className="text-caption font-semibold uppercase tracking-[0.12em] text-textSecondary">Analyse ATS</p>
          {atsScore && atsPercent !== null && atsGrade ? (
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <p className="font-display text-[27px] font-semibold tabular-nums">
                {atsPercent}<span className="text-h3 text-textSecondary">/100</span>
              </p>
              <Badge variant={atsGrade.variant}>{atsGrade.label}</Badge>
              <p className="text-small text-textSecondary">calculé à partir du CV déjà importé, sans poste cible</p>
            </div>
          ) : (
            <p className="mt-2 text-small text-textSecondary">
              Aucun texte de CV importé à analyser pour le moment.
            </p>
          )}
        </div>
        <Button asChild variant="secondary">
          <Link href="/profile/ats"><Gauge className="h-4 w-4" /> Voir l’analyse détaillée</Link>
        </Button>
      </section>

      <div className="mb-8"><ProfileSwitcher currentName={profile.full_name ?? null} /></div>

      <ProfileEditor initial={profile} />

      {/* Ancre #parametres : cible des liens « Profil › Génération IA » ; la carte IA est la première de la section. */}
      <section id="parametres" aria-labelledby="parametres-title" className="mt-12 scroll-mt-28 border-t border-border pt-8">
        <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.15em] text-textSecondary">Configuration</p>
        <h2 id="parametres-title" className="font-display text-h2">Paramètres et données</h2>
        <p className="mt-1 max-w-[65ch] text-body text-textSecondary">Choisissez votre mode de génération et l'emplacement des fichiers. Vous pouvez aussi nettoyer ou remplacer le profil.</p>
        <div className="mt-6 space-y-5"><AiSettings /><SettingsFolder /></div>
        <div className="mt-5 flex flex-wrap items-center gap-2">
          <CleanupButton />
          <Button asChild variant="secondary"><Link href="/onboarding/upload">Remplacer le profil <ArrowRight className="h-4 w-4" /></Link></Button>
        </div>
      </section>
    </>
  );
}
