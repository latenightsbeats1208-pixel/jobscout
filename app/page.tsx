import { redirect } from "next/navigation";
import { getSetting } from "@/lib/db";

// Sans ceci, Next prérend cette page à la compilation : la destination de la
// redirection serait figée d'après la base du poste de build, et une
// installation neuve atterrirait sur /dashboard au lieu de l'onboarding.
export const dynamic = "force-dynamic";

export default async function RootPage() {
  const onboarded = getSetting("has_completed_onboarding") === "true";
  redirect(onboarded ? "/dashboard" : "/onboarding");
}
