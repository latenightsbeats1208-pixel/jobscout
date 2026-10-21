"use client";

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import type { InterviewPrep } from "@/lib/ai/interview-prep";

export function InterviewPrepPanel({ offreId }: { offreId: number }) {
  const [prep, setPrep] = useState<InterviewPrep | null>(null);
  const [experienceTitles, setExperienceTitles] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/offres/${offreId}/interview-prep`, { method: "POST" });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        setError(data?.error || `La préparation a échoué (HTTP ${response.status}).`);
        return;
      }
      if (!data?.prep || !Array.isArray(data.experiences)) {
        setError("Réponse du serveur illisible — réessayez.");
        return;
      }
      setPrep(data.prep as InterviewPrep);
      setExperienceTitles(data.experiences as string[]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Erreur réseau.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-h3">Préparer un entretien</h2>
          <p className="mt-1 text-small text-textSecondary">Questions adaptées à cette offre et à votre profil réel.</p>
        </div>
        <Button onClick={() => void generate()} disabled={loading}>
          {loading ? <><Spinner className="h-4 w-4" /> Préparation…</> : prep ? "Régénérer" : "Préparer"}
        </Button>
      </div>
      {error && <p role="alert" className="mt-4 text-small text-danger">{error}</p>}
      {prep && (
        <div className="mt-5 space-y-5">
          <p className="text-small text-textSecondary">{prep.overview}</p>
          <section>
            <h3 className="text-small font-semibold">Questions probables</h3>
            <ol className="mt-3 space-y-4">
              {prep.questions.map((item, index) => (
                <li key={`${index}-${item.question}`} className="border-l-2 border-accent/40 pl-3">
                  <p className="text-small font-medium">{item.question}</p>
                  <p className="mt-1 text-caption text-textSecondary">{item.rationale}</p>
                  {item.relevant_experience_indexes.length > 0 && (
                    <p className="mt-1 text-caption text-textSecondary">
                      À illustrer avec : {item.relevant_experience_indexes.map((i) => experienceTitles[i]).filter(Boolean).join(" · ")}
                    </p>
                  )}
                </li>
              ))}
            </ol>
          </section>
          <section>
            <h3 className="text-small font-semibold">Questions à poser au recruteur</h3>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-small text-textSecondary">
              {prep.questions_to_ask.map((question, index) => <li key={`${index}-${question}`}>{question}</li>)}
            </ul>
          </section>
          <p className="text-caption text-textSecondary">Préparez vos réponses avec vos propres exemples ; l’IA ne rédige pas de faits à votre place.</p>
        </div>
      )}
    </Card>
  );
}
