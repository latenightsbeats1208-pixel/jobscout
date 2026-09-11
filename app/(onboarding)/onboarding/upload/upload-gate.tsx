"use client";
import { useState } from "react";
import { AiSettings } from "@/components/app/ai-settings";
import { CVUploader } from "./uploader";

/**
 * Gate d'onboarding CLIENT (DESIGN.md §6.3) : l'uploader reste désactivé tant
 * que GET /api/settings/llm ne dit pas « configuré ». Le fetch vit dans la
 * carte AiSettings — pas de getSetting() dans le RSC de la page (piège de
 * prérendu documenté dans app/page.tsx : la valeur serait figée au build).
 */
export function UploadGate() {
  // null = statut pas encore chargé : on garde l'uploader fermé par défaut.
  const [configured, setConfigured] = useState<boolean | null>(null);

  return (
    <div className="space-y-6">
      <AiSettings onStatusChange={({ configured }) => setConfigured(configured)} />
      <CVUploader disabled={configured !== true} />
    </div>
  );
}
