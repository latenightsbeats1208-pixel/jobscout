import { OnboardingStepper } from "@/components/app/onboarding-stepper";
import { UploadGate } from "./upload-gate";

// Pas de getSetting() ici : ce RSC serait prérendu à la compilation et l'état
// de configuration IA figé d'après le poste de build (piège documenté dans
// app/page.tsx). Le gate vit côté client, dans UploadGate.
export default function UploadPage() {
  return (
    <div className="min-h-screen flex flex-col items-center">
      <div className="w-full max-w-[640px] px-6 pt-12">
        <OnboardingStepper current="upload" />
        <div className="text-center mb-12">
          <h1 className="text-display tracking-tight">Bienvenue sur Job Scout.</h1>
          <p className="text-body text-textSecondary mt-4 max-w-md mx-auto">
            Pour commencer, configurez la génération IA puis importez votre CV. Notre IA en
            extrait votre profil — vous pourrez tout vérifier à l'étape suivante.
          </p>
        </div>
        <UploadGate />
      </div>
    </div>
  );
}
