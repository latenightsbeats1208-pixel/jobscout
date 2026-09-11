import { OnboardingStepper } from "@/components/app/onboarding-stepper";
import { PreferencesForm } from "./form";

export default function PreferencesPage() {
  return (
    <div className="min-h-screen flex flex-col items-center">
      <div className="w-full max-w-[640px] px-6 pt-12 pb-20">
        <OnboardingStepper current="preferences" />
        <div className="text-center mb-10">
          <h1 className="text-h1 tracking-tight">Affinez votre recherche</h1>
          <p className="text-body text-textSecondary mt-2">
            Secteurs visés, pays cibles et plateformes à scanner.
          </p>
        </div>
        <PreferencesForm />
      </div>
    </div>
  );
}
