"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Check, MapPin, X } from "lucide-react";
import { cn } from "@/lib/utils";

export type HomeCommune = { code: string; label: string; cps?: string[] };

/**
 * Ville de référence du filtre par distance : bouton « Autour de Lyon (69) » qui ouvre
 * une recherche de commune (base embarquée, aucune donnée envoyée hors de l'ordinateur).
 * La ville du profil est proposée, jamais enregistrée sans clic.
 */
export function DistanceHomePicker({
  home,
  suggestion,
  active = false,
  onSaved,
}: {
  home: HomeCommune | null;
  suggestion: HomeCommune | null;
  /** Un rayon ou le tri « Plus proches » utilise la ville : bouton mis en valeur. */
  active?: boolean;
  onSaved: (home: HomeCommune | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  // Résultats ET la saisie à laquelle ils répondent : une liste périmée n'est jamais cliquable.
  const [found, setFound] = useState<{ q: string; items: HomeCommune[]; error: string | null }>({ q: "", items: [], error: null });
  const [activeIndex, setActiveIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [maxHeight, setMaxHeight] = useState<number | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();

  const q = query.trim();
  const fresh = found.q === q;
  const items = fresh ? found.items : [];
  const searching = q.length >= 2 && !fresh;

  function close(returnFocus = true) {
    setOpen(false);
    setQuery("");
    setFound({ q: "", items: [], error: null });
    setError(null);
    setActiveIndex(0);
    if (returnFocus) trigger.current?.focus();
  }

  useEffect(() => {
    if (!open) return;
    input.current?.focus();
    const onDown = (event: MouseEvent) => {
      if (box.current && !box.current.contains(event.target as Node)) close(false);
    };
    // Place disponible sous le bouton, barre de navigation mobile déduite (sinon la fenêtre passe dessous).
    const fit = () => {
      const top = trigger.current?.getBoundingClientRect().bottom ?? 0;
      const nav = document.querySelector<HTMLElement>('nav[aria-label="Navigation mobile"]');
      const navRect = nav?.getBoundingClientRect();
      const floor = navRect && navRect.height > 0 ? navRect.top : window.innerHeight;
      setMaxHeight(Math.max(220, Math.round(floor - top - 16)));
    };
    fit();
    document.addEventListener("mousedown", onDown);
    window.addEventListener("resize", fit);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("resize", fit);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (q.length < 2) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/geo/communes?q=${encodeURIComponent(q)}`, { signal: controller.signal, cache: "no-store" });
        const data = (await response.json().catch(() => null)) as { communes?: HomeCommune[]; error?: string } | null;
        if (!response.ok) throw new Error(data?.error || "Recherche indisponible.");
        setFound({ q, items: data?.communes ?? [], error: null });
        setActiveIndex(0);
      } catch (e) {
        if (controller.signal.aborted) return;
        setFound({ q, items: [], error: e instanceof TypeError ? "JobScout ne répond pas : réessayez." : e instanceof Error ? e.message : "Recherche indisponible." });
      }
    }, 150);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [q]);

  async function save(code: string | null) {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/geo/home", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const data = (await response.json().catch(() => null)) as { home?: HomeCommune | null; error?: string } | null;
      if (!response.ok) throw new Error(data?.error || "Enregistrement impossible.");
      onSaved(data?.home ?? null);
      close();
    } catch (e) {
      setError(e instanceof TypeError ? "JobScout ne répond pas : réessayez." : e instanceof Error ? e.message : "Enregistrement impossible.");
    } finally {
      setSaving(false);
    }
  }

  function onInputKey(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" && items.length) { event.preventDefault(); setActiveIndex((i) => Math.min(items.length - 1, i + 1)); }
    else if (event.key === "ArrowUp" && items.length) { event.preventDefault(); setActiveIndex((i) => Math.max(0, i - 1)); }
    else if (event.key === "Enter" && items[activeIndex]) { event.preventDefault(); save(items[activeIndex].code); }
  }

  return (
    <div
      ref={box}
      className="relative"
      onKeyDown={(event) => { if (event.key === "Escape" && open) { event.stopPropagation(); close(); } }}
      onBlur={(event) => {
        // Sortie au clavier (Tab) hors de la fenêtre : on la ferme.
        if (open && !box.current?.contains(event.relatedTarget as Node | null)) close(false);
      }}
    >
      <button
        ref={trigger}
        type="button"
        onClick={() => (open ? close() : setOpen(true))}
        aria-expanded={open}
        aria-haspopup="dialog"
        className={cn(
          "inline-flex h-9 max-w-full items-center gap-1.5 rounded-md border px-3 text-small focus:border-accent focus:outline-none",
          active ? "border-accent/40 bg-accent/5 font-semibold text-text" : "border-border bg-bg text-text"
        )}
      >
        <MapPin className="h-4 w-4 shrink-0 text-accent" />
        <span className="truncate">{home ? `Autour de ${home.label}` : "Définir ma ville"}</span>
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Ville de référence pour la distance"
          style={maxHeight ? { maxHeight: `min(${maxHeight}px, 34rem)` } : undefined}
          className="glass-panel absolute left-0 top-11 z-30 max-h-[min(70vh,34rem)] w-[min(calc(100vw-4.75rem),22.5rem)] overflow-y-auto p-4 shadow-lg"
        >
          <p className="text-small font-semibold">Ville de référence</p>
          <p className="mt-1 text-caption text-textSecondary">Les distances sont calculées depuis le centre de cette commune.</p>

          {suggestion && !home && (
            <button type="button" disabled={saving} onMouseDown={(event) => event.preventDefault()} onClick={() => save(suggestion.code)} className="mt-3 flex w-full items-center gap-2 rounded-md border border-accent/40 bg-accent/5 px-3 py-2 text-left text-small font-semibold text-text hover:border-accent disabled:opacity-50">
              <Check className="h-4 w-4 shrink-0 text-accent" /> Utiliser {suggestion.label} <span className="font-normal text-textSecondary">(ville de votre profil)</span>
            </button>
          )}

          <label className="mt-3 block">
            <span className="sr-only">Commune ou code postal</span>
            <input
              ref={input}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={onInputKey}
              placeholder="Commune ou code postal"
              role="combobox"
              aria-expanded={items.length > 0}
              aria-controls={listId}
              aria-autocomplete="list"
              aria-activedescendant={items[activeIndex] ? `${listId}-${items[activeIndex].code}` : undefined}
              className="glass-inset h-10 w-full rounded-md px-3 text-small text-text placeholder:text-textSecondary focus:border-accent focus:outline-none"
            />
          </label>
          {items.length > 0 && (
            <ul id={listId} role="listbox" aria-label="Communes proposées" className="mt-2 max-h-48 overflow-y-auto rounded-md border border-border bg-bg sm:max-h-64">
              {items.map((item, index) => (
                <li key={item.code} id={`${listId}-${item.code}`} role="option" aria-selected={index === activeIndex}>
                  <button
                    type="button"
                    tabIndex={-1}
                    disabled={saving}
                    onMouseDown={(event) => event.preventDefault()}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => save(item.code)}
                    className={cn("flex w-full items-baseline justify-between gap-3 px-3 py-2 text-left text-small hover:bg-surface disabled:opacity-50", index === activeIndex && "bg-surface")}
                  >
                    <span className="font-medium">{item.label}</span>
                    {item.cps?.[0] && <span className="shrink-0 text-caption text-textSecondary tabular-nums">{item.cps.length > 1 ? `${item.cps[0]}…` : item.cps[0]}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {searching && <p className="mt-2 text-caption text-textSecondary" aria-live="polite">Recherche…</p>}
          {fresh && q.length >= 2 && !found.error && items.length === 0 && <p className="mt-2 text-caption text-textSecondary">Aucune commune française ne correspond.</p>}
          {fresh && found.error && <p role="alert" className="mt-2 text-caption text-danger">{found.error}</p>}
          {error && <p role="alert" className="mt-2 text-caption text-danger">{error}</p>}

          {home && (
            <button type="button" disabled={saving} onMouseDown={(event) => event.preventDefault()} onClick={() => save(null)} className="mt-3 inline-flex items-center gap-1.5 text-small font-semibold text-accent hover:underline disabled:opacity-50">
              <X className="h-3.5 w-3.5" /> Retirer ma ville
            </button>
          )}
          <p className="mt-3 border-t border-border pt-3 text-caption text-textSecondary">
            Distances à vol d’oiseau, calculées sur votre ordinateur. La base des communes contient des données sous licence <a href="https://opendatacommons.org/licenses/odbl/1-0/" target="_blank" rel="noopener noreferrer" className="underline hover:text-accent">ODbL</a> (contours administratifs d’Etalab, issus notamment de l’IGN) ; communes et populations : INSEE ; codes postaux : La Poste. Villes du monde : <a href="https://www.geonames.org/" target="_blank" rel="noopener noreferrer" className="underline hover:text-accent">GeoNames</a> (<a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener noreferrer" className="underline hover:text-accent">CC BY 4.0</a>, données modifiées). Sources, licences et modifications : fichier THIRD_PARTY_NOTICES.txt de JobScout.
          </p>
        </div>
      )}
    </div>
  );
}
