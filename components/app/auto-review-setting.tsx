"use client";
import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import { Card } from "@/components/ui/card";

/**
 * Relecture par l'IA après chaque scan. Désactivée par défaut : chaque scan
 * coûte alors jusqu'à quatre appels au modèle de relecture, sur la clé de la
 * personne. Mesuré sur l'audit d'octobre 2026 : avec la relecture, 60 % de
 * bonnes offres dans les 10 premières contre 52 % sans.
 */
export function AutoReviewSetting() {
  const [state, setState] = useState<{ enabled: boolean; configured: boolean; limit: number } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/settings/auto-review", { cache: "no-store" })
      .then((r) => r.json())
      .then(setState)
      .catch(() => setError("Réglage illisible : rechargez la page."));
  }, []);

  async function toggle(enabled: boolean) {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/settings/auto-review", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erreur");
      setState((s) => (s ? { ...s, enabled: data.enabled } : s));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur réseau");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <div className="mb-3 flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-md bg-surface text-textSecondary">
          <Sparkles className="h-5 w-5" />
        </div>
        <h2 className="text-h3">Relecture après chaque scan</h2>
      </div>
      <p className="mb-4 text-small text-textSecondary">
        L&apos;IA relit les {state?.limit ?? 30} meilleures offres de chaque scan : elle repère un diplôme obligatoire qui
        vous manque, un poste trop au-dessus ou en dessous de votre niveau, une spécialité éloignée. Seules les offres
        nouvelles sont relues — au plus quatre appels par scan, sur votre clé.
      </p>
      <label className="flex cursor-pointer items-start gap-3 text-body">
        <input
          type="checkbox"
          className="mt-1 h-4 w-4 shrink-0 accent-[rgb(var(--accent-rgb))]"
          checked={!!state?.enabled}
          disabled={!state || saving}
          onChange={(e) => toggle(e.target.checked)}
        />
        <span>Relire automatiquement les meilleures offres après chaque scan</span>
      </label>
      {state && !state.configured && (
        <p className="mt-2 text-caption text-textSecondary">
          Configurez d&apos;abord la génération IA ci-dessus : sans modèle, la relecture est sautée.
        </p>
      )}
      {error && <p role="alert" className="mt-2 text-small text-danger">{error}</p>}
    </Card>
  );
}
