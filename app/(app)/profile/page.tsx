import Link from "next/link";
import { redirect } from "next/navigation";
import { getProfile } from "@/lib/db/queries";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { SettingsFolder } from "@/components/app/settings-folder";
import { AiSettings } from "@/components/app/ai-settings";
import { CleanupButton } from "@/components/app/cleanup-button";
import { ProfileSwitcher } from "@/components/app/profile-switcher";
import { ProfileEditor } from "./profile-editor";

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const profile = getProfile();
  if (!profile) redirect("/onboarding/upload");

  return (
    <>
      <PageHeader
        title="Profil"
        subtitle={`${profile.experiences.length} expérience(s) · ${profile.educations.length} formation(s) · ${profile.skills.length} compétence(s)`}
        actions={
          <>
            <Button asChild variant="primary">
              <Link href="/profile/add-cv">+ Ajouter un CV</Link>
            </Button>
            <CleanupButton />
            <Button asChild variant="ghost">
              <Link href="/onboarding/upload">Remplacer le profil</Link>
            </Button>
          </>
        }
      />

      <div className="mb-5 space-y-5">
        <ProfileSwitcher currentName={profile.full_name ?? null} />
        <AiSettings />
        <SettingsFolder />
      </div>

      <ProfileEditor initial={profile} />
    </>
  );
}
