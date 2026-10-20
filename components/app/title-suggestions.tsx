"use client";

import { useState } from "react";
import { Plus, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import type { ProfileFull } from "@/lib/cv/types";
import type { TitleFamily, TitleSuggestion } from "@/lib/cv/title-suggestions";

const FAMILY_LABEL: Record<TitleFamily, string> = {
  continuite: "Dans la continuité",
  evolution: "Un cran plus loin",
  voisin: "Métiers voisins",
};
const FAMILY_ORDER: TitleFamily[] = ["continuite", "evolution", "voisin"];

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * « Suggérer à partir de mon CV » : des intitulés justifiés par le profil
 * (lib/ai/suggest-titles.ts), que la personne ajoute un à un à ses postes visés.
 * `profile` : le profil en cours d'édition, envoyé tel quel (il peut ne pas être
 * encore enregistré).
 */
export function TitleSuggestions({ profile, current, onAdd }: { profile: ProfileFull; current: string[]; onAdd: (title: string) => void }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<TitleSuggestion[] | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/profile/suggest-titles", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ profile }),
      });
      const data = (await res.json().catch(() => ({}))) as { suggestions?: TitleSuggestion[]; notice?: string; error?: string };
      if (!res.ok) throw new Error(data.error || "Suggestions indisponibles pour le moment.");
      setSuggestions(data.suggestions ?? []);
      setNotice(data.notice ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Suggestions indisponibles pour le moment.");
    } finally {
      setLoading(false);
    }
  }

  const remaining = (suggestions ?? []).filter((s) => !current.some((c) => same(c, s.title)));

  return (
    <div className="mt-3">
      <Button variant="secondary" size="sm" onClick={load} disabled={loading}>
        {loading ? <Spinner size={14} /> : <Sparkles className="h-3.5 w-3.5" />}
        {loading ? "Lecture de votre parcours…" : suggestions ? "Actualiser les suggestions" : "Suggérer à partir de mon CV"}
      </Button>
      {error && <p role="alert" className="mt-2 text-small text-danger">{error}</p>}
      {notice && <p className="mt-2 text-small text-textSecondary">{notice}</p>}
      {suggestions && !remaining.length && !error && (
        <p className="mt-2 text-small text-textSecondary">
          {suggestions.length ? "Toutes les suggestions sont dans vos postes visés." : "Aucune suggestion assez solide : ajoutez vos expériences ou vos compétences au profil."}
        </p>
      )}
      {remaining.length > 0 && (
        <div className="mt-3 space-y-4" aria-live="polite">
          <p className="text-small text-textSecondary">Gardez-en 2 à 4 : chaque intitulé devient une recherche sur chaque source.</p>
          {FAMILY_ORDER.map((family) => {
            const items = remaining.filter((s) => s.family === family);
            if (!items.length) return null;
            return (
              <div key={family}>
                <p className="mb-1.5 text-caption uppercase tracking-wide text-textSecondary">{FAMILY_LABEL[family]}</p>
                <ul className="space-y-2">
                  {items.map((s) => (
                    <li key={s.title} className="rounded-lg border border-border p-3 text-small">
                      <div className="flex items-start justify-between gap-3">
                        <p className="min-w-0 pt-1 font-medium">{s.title}</p>
                        <Button variant="secondary" size="sm" className="shrink-0" onClick={() => onAdd(s.title)} aria-label={`Ajouter ${s.title} aux postes visés`}>
                          <Plus className="h-3.5 w-3.5" /> Ajouter
                        </Button>
                      </div>
                      {s.reason && <p className="mt-1 text-textSecondary">{s.reason}</p>}
                      <p className="mt-1 text-caption text-textSecondary">Appuis : {s.evidence.join(" · ")}</p>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
