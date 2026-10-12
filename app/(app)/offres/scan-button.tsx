"use client";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Search, X, ChevronDown, Globe, Briefcase, Plane, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { SOURCES_META, sourceLabel } from "@/lib/sources-meta";

type SourceProgress = {
  total: number;
  done: number;
  ok: number;
  failed: number;
  /** « failed » : la source n'a pas répondu (moteur absent, site indisponible…). */
  status: "running" | "done" | "failed";
  error?: string;
};

/** Bilan envoyé par le serveur en fin de scan (lib/scan/orchestrator.ts). */
type ScanOutcome = { status: "done" | "partial" | "failed"; failures: { source: string; message: string }[] };

const SCAN_SOURCES = new Set(SOURCES_META.map((s) => s.id));

type ScanTarget = "all" | string;

const ICON_FOR: Record<string, React.ComponentType<{ className?: string }>> = {
  civiweb: Plane,
};

const TARGETS: {
  id: ScanTarget;
  label: string;
  sublabel: string;
  icon: React.ComponentType<{ className?: string }>;
}[] = [
  { id: "all", label: "Toutes les sources", sublabel: "Sources actives de votre profil", icon: Globe },
  ...SOURCES_META.filter((s) => !s.unavailable).map((s) => ({
    id: s.id,
    label: s.label,
    sublabel: s.sublabel,
    icon: ICON_FOR[s.id] ?? (s.scope === "fr" ? MapPin : Briefcase),
  })),
];

export function ScanButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [target, setTarget] = useState<ScanTarget>("all");
  const [logs, setLogs] = useState<string[]>([]);
  const [sources, setSources] = useState<Record<string, SourceProgress>>({});
  const [outcome, setOutcome] = useState<ScanOutcome | null>(null);
  const esRef = useRef<EventSource | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const titleId = useId();

  useEffect(() => () => esRef.current?.close(), []);

  // Le scan vit dans la connexion SSE : quitter ou recharger la page la ferme
  // et coupe le scan côté serveur (sources suivantes jamais scannées). On
  // demande donc confirmation au navigateur tant qu'il tourne.
  useEffect(() => {
    if (!running) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [running]);

  // Modale bloquante : tout le reste de la page devient inerte (ni clic ni
  // tabulation vers la navigation, qui démonterait ce composant et couperait
  // le scan). Le focus entre dans la modale puis revient au bouton.
  useEffect(() => {
    if (!open) return;
    const overlay = overlayRef.current;
    const made: Element[] = [];
    for (const el of Array.from(document.body.children)) {
      if (el === overlay || el.hasAttribute("inert")) continue;
      el.setAttribute("inert", "");
      made.push(el);
    }
    dialogRef.current?.focus();
    const trigger = triggerRef.current;
    return () => {
      for (const el of made) el.removeAttribute("inert");
      trigger?.focus();
    };
  }, [open]);

  // Échap ferme la modale, seulement une fois le scan terminé.
  useEffect(() => {
    if (!open || running) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, running]);

  // Close dropdown on outside click
  useEffect(() => {
    if (!menuOpen) return;
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [menuOpen]);

  function start(t: ScanTarget = "all") {
    setMenuOpen(false);
    setTarget(t);
    setOpen(true);
    setRunning(true);
    setHasError(false);
    setLogs([]);
    setSources({});
    setOutcome(null);
    const url = t === "all" ? "/api/scan/start" : `/api/scan/start?source=${t}`;
    const es = new EventSource(url);
    esRef.current = es;
    es.onmessage = (msg) => {
      const data = JSON.parse(msg.data);
      handleEvent(data);
      if (data.kind === "close") {
        setRunning(false);
        es.close();
        router.refresh();
      }
    };
    es.onerror = () => {
      setRunning(false);
      setHasError(true);
      setLogs((l) => [...l, "[connexion] interrompue"]);
      es.close();
    };
  }

  function handleEvent(e: any) {
    if (e.kind === "log") {
      setLogs((l) => [...l, e.line]);
      return;
    }
    if (e.kind === "list") {
      setSources((s) => ({
        ...s,
        [e.source]: { total: e.total, done: 0, ok: 0, failed: 0, status: "running" },
      }));
      return;
    }
    if (e.kind === "offre") {
      setSources((s) => {
        const cur = s[e.source] ?? { total: e.total, done: 0, ok: 0, failed: 0, status: "running" };
        return {
          ...s,
          [e.source]: {
            ...cur,
            total: e.total,
            done: cur.done + 1,
            ok: cur.ok + (e.status === "ok" ? 1 : 0),
            failed: cur.failed + (e.status === "failed" ? 1 : 0),
          },
        };
      });
      return;
    }
    if (e.kind === "done") {
      setSources((s) => ({ ...s, [e.source]: { ...s[e.source], status: "done" } }));
      return;
    }
    if (e.kind === "global-done") {
      setOutcome({ status: e.status, failures: e.failures ?? [] });
      return;
    }
    if (e.kind === "error") {
      setHasError(true);
      // Une source en échec s'affiche sur sa ligne (le journal en donne le bilan) ;
      // les autres erreurs (notation, serveur) vont au journal.
      if (SCAN_SOURCES.has(e.source)) {
        setSources((s) => ({
          ...s,
          [e.source]: { ...(s[e.source] ?? { total: 0, done: 0, ok: 0, failed: 0 }), status: "failed", error: e.message },
        }));
      } else {
        setLogs((l) => [...l, `[${e.source}] ${e.message}`]);
      }
    }
  }

  const targetLabel = TARGETS.find((t) => t.id === target)?.label ?? "Toutes les sources";

  return (
    <>
      {/* Split button: main action = scan all, chevron = pick a specific source */}
      <div ref={menuRef} className="relative inline-flex">
        <Button
          ref={triggerRef}
          onClick={() => start("all")}
          disabled={running}
          className="rounded-r-none pr-3"
        >
          <Search className="h-4 w-4" />
          {running ? "Scan en cours…" : "Lancer un scan"}
        </Button>
        <Button
          onClick={() => setMenuOpen((o) => !o)}
          disabled={running}
          aria-label="Choisir une source précise"
          className="rounded-l-none border-l border-white/20 px-2"
        >
          <ChevronDown
            className={cn("h-4 w-4 transition-transform", menuOpen && "rotate-180")}
          />
        </Button>

        {menuOpen && (
          <div className="absolute right-0 top-[calc(100%+6px)] z-40 w-72 bg-bg rounded-lg shadow-elevated border border-border p-1.5 animate-slideUp">
            <p className="px-3 pt-2 pb-1 text-caption uppercase tracking-wide text-textSecondary">
              Scanner une source
            </p>
            {TARGETS.map((t) => {
              const Icon = t.icon;
              return (
                <button
                  key={t.id}
                  onClick={() => start(t.id)}
                  className="w-full flex items-center gap-3 p-2.5 rounded-md hover:bg-surface text-left transition-colors"
                >
                  <div className="h-8 w-8 rounded-md bg-surface flex items-center justify-center text-textSecondary shrink-0">
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-body font-medium truncate">{t.label}</p>
                    <p className="text-caption text-textSecondary truncate">{t.sublabel}</p>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Rendue dans <body> : aucun parent transformé (animation d'entrée de
          page, carte vitrée…) ne peut déplacer cette couche « fixed ». */}
      {open &&
        createPortal(
          <div
            ref={overlayRef}
            className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 backdrop-blur-sm animate-fadeIn sm:items-center"
          >
            <div
              ref={dialogRef}
              role="dialog"
              aria-modal="true"
              aria-labelledby={titleId}
              tabIndex={-1}
              className="max-h-[85dvh] w-full max-w-[560px] overflow-y-auto rounded-t-xl border border-border bg-bg p-5 shadow-elevated outline-none animate-slideUp sm:m-4 sm:rounded-xl sm:p-6"
            >
              <div className="mb-4 flex items-start justify-between gap-4">
                <div>
                  <h2 id={titleId} className="text-h3">{targetLabel}</h2>
                  <p role="status" aria-live="polite" className={cn("text-small", !running && outcome && outcome.status !== "done" ? "font-medium text-danger" : "text-textSecondary")}>
                    {running
                      ? "Recherche en cours. Gardez cette page ouverte : la quitter interromprait le scan."
                      : outcome?.status === "failed"
                      ? "Scan en échec : aucune source n'a répondu"
                      : outcome?.status === "partial"
                      ? `Scan partiel : ${outcome.failures.map((f) => sourceLabel(f.source)).join(", ")} en échec`
                      : hasError
                      ? "Terminé avec des alertes"
                      : "Recherche terminée"}
                  </p>
                </div>
                <button
                  onClick={() => !running && setOpen(false)}
                  disabled={running}
                  aria-label={running ? "Fermeture possible à la fin du scan" : "Fermer la progression"}
                  className="shrink-0 rounded-md p-1 text-textSecondary hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:cursor-not-allowed disabled:opacity-30"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div className="mb-4 space-y-3">
                {Object.entries(sources).map(([name, p]) => (
                  <div key={name}>
                    <div className="mb-1 flex items-center justify-between gap-3 text-small">
                      <span className="font-medium">{sourceLabel(name)}</span>
                      {p.status === "failed" ? (
                        <span className="shrink-0 font-medium text-danger">
                          {p.done > 0 ? `interrompue à ${p.done}/${p.total}` : "en échec"}
                        </span>
                      ) : (
                        <span className="text-textSecondary">
                          {p.done}/{p.total} {p.failed > 0 && `· ${p.failed} échec${p.failed > 1 ? "s" : ""}`}
                        </span>
                      )}
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-surface">
                      <div
                        className={cn("h-full transition-all duration-300", p.status === "failed" ? "bg-danger" : "bg-accent")}
                        style={{ width: `${p.status === "failed" && !p.done ? 100 : p.total ? (p.done / p.total) * 100 : 0}%` }}
                      />
                    </div>
                    {p.error && <p className="mt-1 text-caption text-textSecondary">{p.error}</p>}
                  </div>
                ))}
                {!Object.keys(sources).length && running && (
                  <div className="flex items-center gap-2 text-small text-textSecondary">
                    <Spinner size={14} /> Démarrage…
                  </div>
                )}
              </div>

              {logs.length > 0 && (
                <div className="max-h-32 overflow-y-auto rounded-md bg-surface p-3 font-mono text-caption text-textSecondary">
                  {logs.map((l, i) => (
                    <div key={i}>{l}</div>
                  ))}
                </div>
              )}

              {!running && (
                <div className="mt-4 flex justify-end">
                  <Button variant="secondary" onClick={() => setOpen(false)}>Fermer</Button>
                </div>
              )}
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
