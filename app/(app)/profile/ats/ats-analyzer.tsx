"use client";

import { useRef, useState } from "react";
import { Upload, Gauge, CheckCircle2, XCircle, Lightbulb, RotateCcw } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import type { AtsScoreResult } from "@/lib/ats/score";

const ACCEPT = ".pdf,.docx,.doc,.txt,.png,.jpg,.jpeg";

const GRADE_LABEL: Record<AtsScoreResult["grade"], { label: string; variant: "success" | "info" | "warning" | "danger" }> = {
  excellent: { label: "Excellent", variant: "success" },
  bon: { label: "Bon", variant: "info" },
  moyen: { label: "Moyen", variant: "warning" },
  faible: { label: "Faible", variant: "danger" },
};

export function AtsAnalyzer({
  initialResult = null,
  initialFilename = null,
}: {
  initialResult?: AtsScoreResult | null;
  initialFilename?: string | null;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filename, setFilename] = useState<string | null>(initialFilename);
  const [targetTitle, setTargetTitle] = useState("");
  const [result, setResult] = useState<AtsScoreResult | null>(initialResult);

  async function analyze(file: File) {
    setError(null);
    setFilename(file.name);
    setLoading(true);
    setResult(null);
    try {
      const fd = new FormData();
      fd.append("cv", file);
      if (targetTitle.trim()) fd.append("targetTitle", targetTitle.trim());
      const res = await fetch("/api/ats/score", { method: "POST", body: fd });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError(data?.error || `Erreur d'analyse (HTTP ${res.status}).`);
        return;
      }
      const data = await res.json().catch(() => null);
      if (!data?.score) {
        setError("Réponse du serveur illisible — réessayez.");
        return;
      }
      setResult(data.score);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur réseau");
    } finally {
      setLoading(false);
    }
  }

  const pct = result && result.max > 0 ? Math.round((result.score / result.max) * 100) : null;

  return (
    <div className="space-y-6">
      <Card>
        <div className="flex flex-col gap-4">
          <div>
            <label htmlFor="target-title" className="mb-1.5 block text-small font-semibold text-text">
              Intitulé du poste visé (optionnel, active le critère « mots-clés »)
            </label>
            <input
              id="target-title"
              value={targetTitle}
              onChange={(e) => setTargetTitle(e.target.value)}
              placeholder="Ex. Développeur Full-Stack, Contrôleur de gestion…"
              className="w-full rounded-sm border border-border bg-surface px-3 py-2 text-body text-text placeholder:text-textSecondary/70 focus:outline-none focus:ring-2 focus:ring-accent/40"
            />
          </div>
          <div
            role="button"
            tabIndex={0}
            aria-label="Déposer ou choisir un CV à analyser"
            onClick={() => inputRef.current?.click()}
            onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && inputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              const f = e.dataTransfer.files?.[0];
              if (f) void analyze(f);
            }}
            className={cn(
              "flex cursor-pointer flex-col items-center justify-center gap-3 rounded-[16px] border-2 border-dashed px-6 py-12 text-center transition-colors",
              dragOver ? "border-accent bg-accent/[.06]" : "border-border hover:bg-surfaceHover"
            )}
          >
            {loading ? (
              <Spinner className="h-8 w-8 text-accent" />
            ) : (
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-accent/10 text-accent">
                <Upload className="h-6 w-6" />
              </span>
            )}
            <div>
              <p className="text-body font-semibold">
                {loading ? "Analyse en cours…" : filename ? filename : "Déposez votre CV ou cliquez pour parcourir"}
              </p>
              <p className="mt-1 text-small text-textSecondary">PDF, DOCX, TXT ou image · le fichier ne quitte pas votre machine</p>
            </div>
            <input
              ref={inputRef}
              type="file"
              accept={ACCEPT}
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void analyze(f);
                e.target.value = "";
              }}
            />
          </div>
          {error && <p className="text-small text-danger">{error}</p>}
        </div>
      </Card>

      {result && (
        <>
          <Card>
            <div className="flex flex-wrap items-center gap-6">
              <div className="flex items-center gap-4">
                <span className={cn(
                  "flex h-16 w-16 items-center justify-center rounded-full",
                  result.grade === "excellent" && "bg-success/15 text-success",
                  result.grade === "bon" && "bg-accent/15 text-accent",
                  result.grade === "moyen" && "bg-warning/15 text-warning",
                  result.grade === "faible" && "bg-danger/15 text-danger"
                )}>
                  <Gauge className="h-8 w-8" />
                </span>
                <div>
                  <p className="font-display text-[40px] font-semibold leading-none tabular-nums">
                    {pct}
                    <span className="text-h3 text-textSecondary"> /100</span>
                  </p>
                  <p className="text-small text-textSecondary">{result.score} points sur {result.max} au barème complet</p>
                </div>
              </div>
              <Badge variant={GRADE_LABEL[result.grade].variant}>{GRADE_LABEL[result.grade].label}</Badge>
              {filename && <p className="text-small text-textSecondary">{filename}</p>}
            </div>
          </Card>

          <Card>
            <h2 className="mb-4 text-h3 font-semibold">Détail du barème</h2>
            <ul className="space-y-3">
              {result.criteria.map((c) => (
                <li key={c.id} className="flex items-start gap-3">
                  {c.max === 0 ? (
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-surfaceHover text-textSecondary">
                      <Lightbulb className="h-3.5 w-3.5" />
                    </span>
                  ) : c.ok ? (
                    <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-success" />
                  ) : (
                    <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-danger" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-body font-medium">
                      {c.label}
                      {c.max > 0 && (
                        <span className="ml-2 text-small tabular-nums text-textSecondary">{c.points}/{c.max} pts</span>
                      )}
                    </p>
                    <p className="text-small text-textSecondary">{c.detail}</p>
                  </div>
                </li>
              ))}
            </ul>
          </Card>

          {result.suggestions.length > 0 && (
            <Card>
              <h2 className="mb-4 text-h3 font-semibold">
                Améliorations proposées ({result.suggestions.length})
              </h2>
              <ul className="space-y-4">
                {result.suggestions.map((s, i) => (
                  <li key={i} className="flex items-start gap-3 rounded-[12px] bg-surfaceHover p-4">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-warning/15 text-[11px] font-bold tabular-nums text-warning">
                      +{s.gain}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-body font-medium">{s.issue}</p>
                      <p className="mt-1 text-small text-textSecondary">{s.fix}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => inputRef.current?.click()}>
              <RotateCcw className="h-4 w-4" /> Analyser un autre CV
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
