"use client";
import { useId } from "react";
import { DEPARTEMENTS, REGIONS, parseSearchArea, searchAreaLabel } from "@/lib/geo/fr";
import { buildSearchPlan } from "@/lib/scan/search-plan";
import type { ProfileFull } from "@/lib/cv/types";

/** Zone de recherche en France : tout le pays, une région ou un département. */
export function SearchAreaSelect({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="text-caption uppercase text-textSecondary">
        Zone de recherche en France
      </label>
      <select
        id={id}
        value={parseSearchArea(value) ? value : ""}
        onChange={(e) => onChange(e.target.value)}
        className="mt-2 h-11 w-full rounded-md border border-border bg-surface px-3 text-small text-text"
      >
        <option value="">Toute la France</option>
        <optgroup label="Régions">
          {REGIONS.map((r) => (
            <option key={r.code} value={`R:${r.code}`}>
              {r.name}
            </option>
          ))}
        </optgroup>
        <optgroup label="Départements">
          {DEPARTEMENTS.map((d) => (
            <option key={d.code} value={`D:${d.code}`}>
              {d.code} — {d.name}
            </option>
          ))}
        </optgroup>
      </select>
      <p className="mt-1.5 text-caption text-textSecondary">
        Appliquée par France Travail, HelloWork et Talent.com. Welcome to the Jungle et LinkedIn cherchent dans tout le pays.
      </p>
    </div>
  );
}

const ORIGIN_NOTE: Record<string, string> = {
  experiences: " — faute de poste visé, les intitulés de vos expériences",
  secteurs: " — faute de poste visé, vos secteurs",
};

/** « Le prochain scan cherchera… » : les requêtes réellement envoyées aux sources. */
export function SearchPlanPreview({ profile }: { profile: ProfileFull }) {
  const plan = buildSearchPlan(profile);
  return (
    <p className="text-small text-textSecondary" role="status">
      {plan.queries.length ? (
        <>
          Le prochain scan cherchera {plan.queries.map((q) => `« ${q} »`).join(", ")}
          {ORIGIN_NOTE[plan.origin] ?? ""}, {plan.area ? `dans la zone ${searchAreaLabel(plan.area)}` : "dans tout le pays"}.
        </>
      ) : (
        "Ajoutez un poste visé : c'est lui que chaque source cherchera."
      )}
    </p>
  );
}
