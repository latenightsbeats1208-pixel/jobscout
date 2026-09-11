import { OnboardingStepper } from "@/components/app/onboarding-stepper";
import { VerifyForm } from "./form";

export default function VerifyPage() {
  return (
    <div className="min-h-screen flex flex-col items-center">
      <div className="w-full max-w-[760px] px-6 pt-12 pb-20">
        <OnboardingStepper current="verify" />
        <div className="text-center mb-10">
          <h1 className="text-h1 tracking-tight">Vérifiez les informations extraites</h1>
          <p className="text-body text-textSecondary mt-2">
            Modifiez ce qui n'est pas correct, ajoutez ce qui manque.
          </p>
        </div>
        <VerifyForm />
      </div>
    </div>
  );
}
