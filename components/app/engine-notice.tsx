"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Download, Check, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

type EngineState = {
  installed: boolean;
  installing: boolean;
  progress: number | null;
  message: string;
  error: string | null;
  size: string;
  diskSize?: string;
};

/**
 * Encart affiché quand LinkedIn est coché : LinkedIn est la seule source qui
 * exige un navigateur Chromium (~100 Mo à télécharger, ~265 Mo sur le disque).
 * Il n'est pas fourni avec
 * l'application, il se télécharge ici, une seule fois, à la demande.
 */
export function EngineNotice({
  active,
  className,
}: {
  active: boolean;
  className?: string;
}) {
  const [state, setState] = useState<EngineState | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/engine", { cache: "no-store" });
      if (!res.ok) return;
      const data: EngineState = await res.json();
      setState(data);
      if (data.installing) timer.current = setTimeout(refresh, 1500);
    } catch {
      /* hors-ligne : on n'affiche rien de plus */
    }
  }, []);

  useEffect(() => {
    if (!active) return;
    refresh();
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [active, refresh]);

  if (!active || !state) return null;

  if (state.installed && !state.installing) {
    return (
      <div
        className={cn(
          "flex items-center gap-2 rounded-md border border-border bg-surface px-3 py-2 text-small text-textSecondary",
          className
        )}
      >
        <Check className="h-4 w-4 text-accent shrink-0" />
        Moteur LinkedIn installé — la source est opérationnelle.
      </div>
    );
  }

  async function install() {
    setState((s) => (s ? { ...s, installing: true, error: null } : s));
    await fetch("/api/engine", { method: "POST" }).catch(() => {});
    refresh();
  }

  return (
    <div
      className={cn(
        "rounded-md border border-border bg-surface px-3 py-3 space-y-2",
        className
      )}
    >
      <div className="flex items-start gap-2">
        <Download className="h-4 w-4 mt-0.5 shrink-0 text-textSecondary" />
        <div className="min-w-0 text-small">
          <p className="font-medium">
            Moteur LinkedIn requis ({state.size} à télécharger
            {state.diskSize ? `, ${state.diskSize} sur le disque` : ""})
          </p>
          <p className="text-textSecondary">
            LinkedIn est la seule source qui a besoin d'un navigateur Chromium. Il
            n'est pas fourni avec l'application : téléchargez-le une fois ici. Les six
            autres sources fonctionnent sans.
          </p>
        </div>
      </div>

      {state.installing ? (
        <div className="flex items-center gap-2 text-small text-textSecondary">
          <Spinner size={14} />
          <span className="truncate">
            {state.progress != null ? `${state.progress} % — ` : ""}
            {state.message || "Téléchargement en cours…"}
          </span>
        </div>
      ) : (
        <Button variant="secondary" size="sm" onClick={install} type="button">
          <Download className="h-4 w-4" /> Installer le moteur LinkedIn
        </Button>
      )}

      {state.error && (
        <p className="flex items-start gap-2 text-small text-danger">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          {state.error}
        </p>
      )}
    </div>
  );
}
