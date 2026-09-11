"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, X, ChevronDown, Globe, Briefcase, Plane, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { SOURCES_META } from "@/lib/sources-meta";

type SourceProgress = {
  total: number;
  done: number;
  ok: number;
  failed: number;
  status: "running" | "done";
};

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
  { id: "all", label: "Toutes les sources", sublabel: "7 plateformes en parallèle", icon: Globe },
  ...SOURCES_META.map((s) => ({
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
  const [target, setTarget] = useState<ScanTarget>("all");
  const [logs, setLogs] = useState<string[]>([]);
  const [sources, setSources] = useState<Record<string, SourceProgress>>({});
  const esRef = useRef<EventSource | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => () => esRef.current?.close(), []);

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
    setLogs([]);
    setSources({});
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
    if (e.kind === "error") {
      setLogs((l) => [...l, `[${e.source}] ${e.message}`]);
    }
  }

  const targetLabel = TARGETS.find((t) => t.id === target)?.label ?? "Toutes les sources";

  return (
    <>
      {/* Split button: main action = scan all, chevron = pick a specific source */}
      <div ref={menuRef} className="relative inline-flex">
        <Button
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

      {open && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/30 backdrop-blur-sm animate-fadeIn">
          <div className="bg-bg rounded-t-xl sm:rounded-xl w-full max-w-[560px] shadow-elevated p-6 m-0 sm:m-4 animate-slideUp">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h2 className="text-h3">Scan — {targetLabel}</h2>
                <p className="text-small text-textSecondary">
                  {running ? "Analyse en cours…" : "Scan terminé"}
                </p>
              </div>
              <button
                onClick={() => !running && setOpen(false)}
                disabled={running}
                className="text-textSecondary hover:text-text disabled:opacity-30"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-3 mb-4">
              {Object.entries(sources).map(([name, p]) => (
                <div key={name}>
                  <div className="flex items-center justify-between text-small mb-1">
                    <span className="font-medium capitalize">{name}</span>
                    <span className="text-textSecondary">
                      {p.done}/{p.total} {p.failed > 0 && `· ${p.failed} échecs`}
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full bg-surface overflow-hidden">
                    <div
                      className="h-full bg-accent transition-all duration-300"
                      style={{ width: `${p.total ? (p.done / p.total) * 100 : 0}%` }}
                    />
                  </div>
                </div>
              ))}
              {!Object.keys(sources).length && running && (
                <div className="flex items-center gap-2 text-small text-textSecondary">
                  <Spinner size={14} /> Démarrage…
                </div>
              )}
            </div>

            {logs.length > 0 && (
              <div className="bg-surface rounded-md p-3 max-h-32 overflow-y-auto font-mono text-caption text-textSecondary">
                {logs.map((l, i) => (
                  <div key={i}>{l}</div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
