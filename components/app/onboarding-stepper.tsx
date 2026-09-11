import { cn } from "@/lib/utils";
import { Check } from "lucide-react";

const STEPS = [
  { id: "upload", label: "Importer" },
  { id: "verify", label: "Vérifier" },
  { id: "preferences", label: "Préférences" },
];

export function OnboardingStepper({ current }: { current: "upload" | "verify" | "preferences" }) {
  const idx = STEPS.findIndex((s) => s.id === current);
  return (
    <div className="flex items-center justify-center gap-3 py-8">
      {STEPS.map((s, i) => {
        const done = i < idx;
        const active = i === idx;
        return (
          <div key={s.id} className="flex items-center gap-3">
            <div
              className={cn(
                "flex items-center justify-center h-7 w-7 rounded-full text-small font-semibold transition-colors",
                done
                  ? "bg-accent text-white"
                  : active
                  ? "bg-text text-bg"
                  : "bg-surface text-textSecondary"
              )}
            >
              {done ? <Check className="h-4 w-4" /> : i + 1}
            </div>
            <span
              className={cn(
                "text-small font-medium",
                active ? "text-text" : done ? "text-textSecondary" : "text-textSecondary/60"
              )}
            >
              {s.label}
            </span>
            {i < STEPS.length - 1 && <div className="w-12 h-px bg-border mx-2" />}
          </div>
        );
      })}
    </div>
  );
}
