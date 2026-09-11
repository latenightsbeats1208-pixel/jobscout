"use client";
import { useMemo, useState, useRef } from "react";
import Link from "next/link";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowDownNarrowWide } from "lucide-react";
import { Chip } from "@/components/ui/chip";
import { Badge } from "@/components/ui/badge";
import { formatRelativeDate, scoreColor } from "@/lib/utils";
import type { OffreFiltered } from "@/lib/db/offres";
import {
  CONTRACT_LABELS,
  CONTRACT_ORDER,
  type ContractCategory,
} from "@/lib/contracts";

import { SOURCES_META } from "@/lib/sources-meta";

const SOURCES = SOURCES_META.map((s) => ({ id: s.id, label: s.label }));

type SortMode = "smart" | "newest" | "oldest" | "score";

const SORT_OPTIONS: { id: SortMode; label: string }[] = [
  { id: "smart", label: "Pertinence" },
  { id: "newest", label: "Plus récentes" },
  { id: "oldest", label: "Plus anciennes" },
  { id: "score", label: "Meilleur score" },
];

export function OffresList({ initial }: { initial: OffreFiltered[] }) {
  const [filterSource, setFilterSource] = useState<string | null>(null);
  const [filterCountry, setFilterCountry] = useState<string | null>(null);
  const [filterContracts, setFilterContracts] = useState<Set<ContractCategory>>(new Set());
  const [minScore, setMinScore] = useState<number | null>(null);
  const [sortBy, setSortBy] = useState<SortMode>("smart");

  const filtered = useMemo(() => {
    const arr = initial.filter((o) => {
      if (filterSource && o.source !== filterSource) return false;
      if (filterCountry && o.country !== filterCountry) return false;
      if (filterContracts.size > 0 && !filterContracts.has(o.contract_category)) return false;
      if (minScore != null && (o.score ?? 0) < minScore) return false;
      return true;
    });

    // Apply chosen sort. The DB already returns rows in "smart" order, so we only re-sort if needed.
    if (sortBy === "smart") return arr;

    const today = new Date().toISOString().slice(0, 10);
    const sorted = [...arr];
    if (sortBy === "newest") {
      sorted.sort((a, b) => (b.posted_at ?? "").localeCompare(a.posted_at ?? ""));
    } else if (sortBy === "oldest") {
      sorted.sort((a, b) => {
        // Empty dates fall to the end
        if (!a.posted_at && !b.posted_at) return 0;
        if (!a.posted_at) return 1;
        if (!b.posted_at) return -1;
        return a.posted_at.localeCompare(b.posted_at);
      });
    } else if (sortBy === "score") {
      sorted.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
    }
    return sorted;
  }, [initial, filterSource, filterCountry, filterContracts, minScore, sortBy]);

  const countries = useMemo(() => {
    const set = new Set<string>();
    initial.forEach((o) => o.country && set.add(o.country));
    return Array.from(set).sort();
  }, [initial]);

  const contractCounts = useMemo(() => {
    const counts: Record<ContractCategory, number> = {
      cdi: 0, cdd: 0, vie: 0, stage: 0, alternance: 0, autre: 0,
    };
    initial.forEach((o) => {
      counts[o.contract_category] = (counts[o.contract_category] ?? 0) + 1;
    });
    return counts;
  }, [initial]);

  const parentRef = useRef<HTMLDivElement>(null);
  // 2 columns on >=md, otherwise 1
  const rows = useMemo(() => {
    const out: OffreFiltered[][] = [];
    for (let i = 0; i < filtered.length; i += 2) {
      out.push([filtered[i], filtered[i + 1]].filter(Boolean) as OffreFiltered[]);
    }
    return out;
  }, [filtered]);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 200,
    overscan: 6,
  });

  function toggleContract(c: ContractCategory) {
    setFilterContracts((prev) => {
      const next = new Set(prev);
      if (next.has(c)) next.delete(c);
      else next.add(c);
      return next;
    });
  }

  const hasFilter =
    !!filterSource || !!filterCountry || filterContracts.size > 0 || minScore != null;

  return (
    <div>
      <div className="space-y-3 mb-6">
        {/* Contract category row */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-caption uppercase tracking-wide text-textSecondary mr-2">
            Contrat
          </span>
          {CONTRACT_ORDER.filter((c) => contractCounts[c] > 0).map((c) => (
            <Chip
              key={c}
              active={filterContracts.has(c)}
              onClick={() => toggleContract(c)}
            >
              {CONTRACT_LABELS[c]}
              <span className="opacity-60 ml-1">{contractCounts[c]}</span>
            </Chip>
          ))}
        </div>

        {/* Source / country / score row */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-caption uppercase tracking-wide text-textSecondary mr-2">
            Source
          </span>
          {SOURCES.map((s) => (
            <Chip
              key={s.id}
              active={filterSource === s.id}
              onClick={() => setFilterSource(filterSource === s.id ? null : s.id)}
            >
              {s.label}
            </Chip>
          ))}
          {countries.length > 0 && (
            <>
              <span className="w-px h-5 bg-border mx-2" />
              <span className="text-caption uppercase tracking-wide text-textSecondary mr-1">
                Pays
              </span>
              {countries.slice(0, 14).map((c) => (
                <Chip
                  key={c}
                  active={filterCountry === c}
                  onClick={() => setFilterCountry(filterCountry === c ? null : c)}
                >
                  {c}
                </Chip>
              ))}
            </>
          )}
          <span className="w-px h-5 bg-border mx-2" />
          <Chip active={minScore === 60} onClick={() => setMinScore(minScore === 60 ? null : 60)}>
            Score ≥ 60
          </Chip>
          {hasFilter && (
            <button
              onClick={() => {
                setFilterSource(null);
                setFilterCountry(null);
                setFilterContracts(new Set());
                setMinScore(null);
              }}
              className="text-small text-accent hover:underline ml-2"
            >
              Réinitialiser
            </button>
          )}
          <span className="ml-auto text-small text-textSecondary">
            {filtered.length} résultat(s)
          </span>
        </div>

        {/* Sort selector */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-caption uppercase tracking-wide text-textSecondary mr-2 inline-flex items-center gap-1">
            <ArrowDownNarrowWide className="h-3.5 w-3.5" /> Trier
          </span>
          {SORT_OPTIONS.map((s) => (
            <Chip key={s.id} active={sortBy === s.id} onClick={() => setSortBy(s.id)}>
              {s.label}
            </Chip>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-20 text-textSecondary">
          <p className="text-body">Aucune offre. Lancez un scan pour commencer.</p>
        </div>
      ) : (
        <div ref={parentRef} className="h-[calc(100vh-300px)] overflow-auto -mx-2">
          <div style={{ height: virtualizer.getTotalSize(), position: "relative", width: "100%" }}>
            {virtualizer.getVirtualItems().map((vi) => {
              const row = rows[vi.index];
              return (
                <div
                  key={vi.key}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    transform: `translateY(${vi.start}px)`,
                  }}
                  className="px-2"
                >
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pb-4">
                    {row.map((o) => (
                      <OffreCard key={o.id} offre={o} />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function OffreCard({ offre }: { offre: OffreFiltered }) {
  const sc = scoreColor(offre.score ?? 0);
  const isFailed = offre.description_status === "failed";
  return (
    <Link
      href={`/offres/${offre.id}`}
      className="block bg-bg rounded-lg shadow-card p-5 hover:shadow-elevated transition-all duration-200 active:scale-[0.99]"
    >
      <div className="flex items-start justify-between gap-3 mb-2">
        <h3 className="text-h3 line-clamp-2 flex-1">{offre.title}</h3>
        <span
          className="shrink-0 inline-flex items-center justify-center rounded-full px-2.5 h-7 text-small font-semibold"
          style={{ background: sc.bg, color: sc.fg }}
        >
          {offre.score ?? 0}
        </span>
      </div>
      <div className="flex items-center gap-2 text-small text-textSecondary mb-3">
        <span className="font-medium text-text">{offre.company}</span>
        {offre.country && <span>· {offre.country}</span>}
        {offre.location && <span>· {offre.location}</span>}
      </div>
      <p className="text-small text-textSecondary line-clamp-3 mb-3">
        {isFailed ? "⚠ Description non récupérée — cliquez pour réessayer." : offre.description_text.slice(0, 240)}
      </p>
      <div className="flex items-center justify-between gap-2 text-caption text-textSecondary">
        <div className="flex items-center gap-2">
          <Badge variant="default">{offre.source}</Badge>
          {offre.contract_category !== "autre" && (
            <Badge variant={offre.contract_category === "vie" ? "info" : "default"}>
              {CONTRACT_LABELS[offre.contract_category]}
            </Badge>
          )}
        </div>
        {offre.posted_at && <span>{formatRelativeDate(offre.posted_at)}</span>}
      </div>
    </Link>
  );
}
