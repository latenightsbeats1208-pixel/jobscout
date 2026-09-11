"use client";
import { useCallback, useEffect, useState } from "react";
import { AlertCircle, Check, KeyRound, RotateCcw, Sparkles } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

type Quota = {
  points_remaining: number | null;
  dossiers_estimes: number | null;
  plan: string | null;
};

type LlmStatus = {
  mode: "pack" | "byok" | "unset";
  configured: boolean;
  source: "settings" | "env" | null;
  licenseHint: string | null;
  byokHint: string | null;
  quota: Quota | null;
};

/**
 * Carte de configuration de la génération IA (patron settings-folder).
 * Montée dans l'onboarding (avant l'uploader, qu'elle débloque) et dans la
 * pile de cartes du Profil. Les clés ne transitent JAMAIS en clair depuis le
 * serveur : seuls des hints masqués (…XXXX) sont affichés.
 */
export function AiSettings({
  onStatusChange,
}: {
  onStatusChange?: (status: { configured: boolean }) => void;
}) {
  const [status, setStatus] = useState<LlmStatus | null>(null);
  const [mode, setMode] = useState<"pack" | "byok">("pack");
  const [licenseKey, setLicenseKey] = useState("");
  const [byokKey, setByokKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/settings/llm", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json().catch(() => null)) as LlmStatus | null;
      if (!data) return;
      setStatus(data);
      if (data.mode === "pack" || data.mode === "byok") setMode(data.mode);
      onStatusChange?.({ configured: !!data.configured });
    } catch {
      // hors-ligne : la carte reste utilisable, le gate reste fermé
    }
  }, [onStatusChange]);

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function call(action: "save" | "verify" | "reset") {
    setLoading(true);
    setError(null);
    setInfo(null);
    try {
      const res = await fetch("/api/settings/llm", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action,
          mode,
          license_key: licenseKey.trim() || undefined,
          byok_key: byokKey.trim() || undefined,
        }),
      });
      const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
      if (!res.ok) {
        setError(
          (data && typeof data.error === "string" && data.error) ||
            `Erreur serveur (HTTP ${res.status}).`
        );
        return;
      }
      if (action === "verify") {
        const quota = (data?.quota ?? null) as Quota | null;
        setInfo(
          mode === "pack"
            ? `Licence valide ✓${
                quota?.dossiers_estimes != null
                  ? ` — ≈ ${quota.dossiers_estimes} dossiers restants`
                  : ""
              }`
            : "Clé API Anthropic valide ✓"
        );
        return;
      }
      if (action === "reset") {
        setLicenseKey("");
        setByokKey("");
        setInfo("Configuration réinitialisée.");
      } else {
        setLicenseKey("");
        setByokKey("");
        setInfo(
          mode === "pack" ? "Pack JobScout activé ✓" : "Clé API personnelle activée ✓"
        );
      }
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur réseau");
    } finally {
      setLoading(false);
    }
  }

  const configured = !!status?.configured;
  const keyEntered = mode === "pack" ? !!licenseKey.trim() : !!byokKey.trim();
  const storedHint = mode === "pack" ? status?.licenseHint : status?.byokHint;
  const canSubmit = keyEntered || !!storedHint;

  return (
    <Card data-testid="ai-settings">
      <div className="flex items-center gap-2 mb-3">
        <div className="h-8 w-8 rounded-md bg-surface flex items-center justify-center text-textSecondary">
          <Sparkles className="h-5 w-5" />
        </div>
        <h2 className="text-h3">Génération IA</h2>
        {configured && (
          <span className="ml-auto inline-flex items-center gap-1 text-caption text-success">
            <Check className="h-3.5 w-3.5" />
            {status?.mode === "pack" ? "Pack actif" : "Clé API active"}
          </span>
        )}
      </div>
      <p className="text-small text-textSecondary mb-4">
        L'extraction de CV et la génération des documents utilisent l'IA. Choisissez le pack
        inclus avec votre licence JobScout, ou votre propre clé API Anthropic (facturée à
        l'usage, à vos frais).
      </p>

      {/* Choix du mode : deux chips */}
      <div className="flex flex-wrap gap-2 mb-4">
        <ModeChip
          active={mode === "pack"}
          onClick={() => {
            setMode("pack");
            setError(null);
            setInfo(null);
          }}
        >
          Pack JobScout (licence)
        </ModeChip>
        <ModeChip
          active={mode === "byok"}
          onClick={() => {
            setMode("byok");
            setError(null);
            setInfo(null);
          }}
        >
          Ma clé API Anthropic
        </ModeChip>
      </div>

      {mode === "pack" ? (
        <>
          <Input
            type="password"
            value={licenseKey}
            onChange={(e) => setLicenseKey(e.target.value)}
            placeholder="JSC-XXXXXXXXXXXXXXXX"
            autoComplete="off"
            spellCheck={false}
          />
          <p className="text-caption text-textSecondary mt-1.5">
            {status?.licenseHint ? (
              <>Clé de licence enregistrée : <code>{status.licenseHint}</code></>
            ) : (
              <>Votre clé de licence vous a été envoyée à l'achat de JobScout.</>
            )}
          </p>
        </>
      ) : (
        <>
          <Input
            type="password"
            value={byokKey}
            onChange={(e) => setByokKey(e.target.value)}
            placeholder="sk-ant-…"
            autoComplete="off"
            spellCheck={false}
          />
          <p className="text-caption text-textSecondary mt-1.5">
            {status?.byokHint ? (
              <>Clé API enregistrée : <code>{status.byokHint}</code></>
            ) : (
              <>Créez une clé sur console.anthropic.com — elle reste sur cette machine.</>
            )}
          </p>
        </>
      )}

      <div className="flex flex-wrap items-center gap-2 mt-4">
        <Button onClick={() => call("save")} disabled={loading || !canSubmit}>
          {loading ? <Spinner size={16} className="text-white" /> : <Check className="h-4 w-4" />}
          Enregistrer
        </Button>
        <Button variant="secondary" onClick={() => call("verify")} disabled={loading || !canSubmit}>
          <KeyRound className="h-4 w-4" />
          Vérifier
        </Button>
        {configured && status?.source === "settings" && (
          <Button variant="ghost" onClick={() => call("reset")} disabled={loading}>
            <RotateCcw className="h-4 w-4" /> Réinitialiser
          </Button>
        )}
      </div>

      {status?.mode === "pack" && status.quota?.points_remaining != null && (
        <p className="text-caption text-textSecondary mt-3">
          Pack : ≈ {status.quota.dossiers_estimes ?? Math.floor(status.quota.points_remaining / 10)}{" "}
          dossiers restants ({status.quota.points_remaining} points).
        </p>
      )}
      {status?.source === "env" && (
        <p className="text-caption text-textSecondary mt-3">
          Mode développement : clé API lue depuis l'environnement.
        </p>
      )}

      {info && (
        <div className="mt-3 flex items-start gap-2 p-3 rounded-md bg-[rgba(48,209,88,0.08)] text-success text-small">
          <Check className="h-4 w-4 mt-0.5 shrink-0" /> {info}
        </div>
      )}
      {error && (
        <div className="mt-3 flex items-start gap-2 p-3 rounded-md bg-[rgba(255,59,48,0.08)] text-danger text-small">
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" /> {error}
        </div>
      )}
    </Card>
  );
}

function ModeChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "h-9 px-4 rounded-full border text-small font-medium transition-colors",
        active
          ? "border-accent bg-accent/10 text-accent"
          : "border-border bg-surface text-textSecondary hover:text-text hover:bg-surfaceHover"
      )}
    >
      {children}
    </button>
  );
}
