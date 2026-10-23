"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, ArrowUpRight, Briefcase, CalendarDays, ChevronDown, MapPin, RotateCcw, Search, SlidersHorizontal } from "lucide-react";
import { Chip } from "@/components/ui/chip";
import { Badge } from "@/components/ui/badge";
import { cn, formatRelativeDate, scoreColor } from "@/lib/utils";
import type { OffreSummary, OffersSearch, OffersSort } from "@/lib/db/offres";
import { CONTRACT_LABELS, CONTRACT_ORDER, type ContractCategory } from "@/lib/contracts";
import { SOURCES_META } from "@/lib/sources-meta";
import { previewExcerpt } from "@/lib/offres/preview";
import { DISTANCE_RADII, distanceLabel, isApproximate, radiusLabel } from "@/lib/distance/format";
import { DistanceHomePicker, type HomeCommune } from "@/components/app/distance-home";

const sourceLabels = Object.fromEntries(SOURCES_META.map((source) => [source.id, source.label]));
const numberFormat = new Intl.NumberFormat("fr-FR");

/** « 1 offre correspond », « 12 offres correspondent », « Aucune offre ne correspond ». */
function resultLabel(total: number, filtered: boolean): string {
  if (filtered) {
    if (total === 0) return "Aucune offre ne correspond à vos critères";
    return total === 1 ? "1 offre correspond à vos critères" : `${numberFormat.format(total)} offres correspondent à vos critères`;
  }
  return total <= 1 ? `${total} offre à explorer` : `${numberFormat.format(total)} offres à explorer`;
}

/** Seuil de la puce de score, sauf arrivée par ?score=N (carte de l'accueil). */
const DEFAULT_MIN_SCORE = 60;

export function OffresList({
  initialResult,
  initialVieOnly = false,
  initialMinScore = 0,
  homeSuggestion = null,
  initialNewOnly = false,
}: {
  initialResult: OffersSearch;
  initialVieOnly?: boolean;
  initialMinScore?: number;
  /** Commune proposée d'après le lieu du profil, tant qu'aucune ville de référence n'est choisie. */
  homeSuggestion?: HomeCommune | null;
  initialNewOnly?: boolean;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [source, setSource] = useState("");
  const [country, setCountry] = useState("");
  // ?vie=1 (carte de l'accueil) coche simplement la puce contrat « V.I.E » : une seule
  // règle (contract_category), un seul filtre à retirer.
  const [contracts, setContracts] = useState<Set<ContractCategory>>(() => new Set(initialVieOnly ? ["vie"] : []));
  const scoreThreshold = initialMinScore || DEFAULT_MIN_SCORE;
  const [minScore, setMinScore] = useState(initialMinScore > 0);
  const [newOnly, setNewOnly] = useState(initialNewOnly);
  const [sortBy, setSortBy] = useState<OffersSort>("smart");
  // Distance : rayon en km (0 = dans la commune), null = toutes distances.
  const [radius, setRadius] = useState<number | null>(null);
  const [includeUnlocated, setIncludeUnlocated] = useState(false);
  const [result, setResult] = useState(initialResult);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [filtersExpanded, setFiltersExpanded] = useState(false);
  const firstRequest = useRef(true);
  const initialRef = useRef(initialResult);
  const initialVieRef = useRef(initialVieOnly);
  const contractKey = [...contracts].sort().join(",");
  const vieFilter = contracts.has("vie");
  const hasFilters = !!query || !!source || !!country || contracts.size > 0 || minScore || radius !== null;
  const activeFilterCount = Number(!!source) + Number(!!country) + contracts.size + Number(minScore) + Number(radius !== null);
  const distanceFacets = result.facets.distance;
  const home = distanceFacets.home;
  const hasFilters = !!query || !!source || !!country || contracts.size > 0 || minScore || newOnly;
  const activeFilterCount = Number(!!source) + Number(!!country) + contracts.size + Number(minScore) + Number(newOnly);
  const { countries, sources, contractCounts } = result.facets;
  const shown = result.offers;
  const remaining = Math.max(0, result.total - shown.length);
  const selected = shown.find((offer) => offer.id === selectedId) ?? shown[0] ?? null;

  // Navigation vers /offres?vie=1 sans quitter la page (lien de l'accueil) : on coche V.I.E.
  useEffect(() => {
    if (initialVieRef.current === initialVieOnly) return;
    initialVieRef.current = initialVieOnly;
    if (initialVieOnly) {
      setContracts((previous) => new Set(previous).add("vie"));
      setPage(1);
    }
  }, [initialVieOnly]);

  // Arrivé par ?vie=1 ou ?score=N puis filtre retiré : l'URL doit suivre, sinon le
  // router.refresh() de fin de scan renverrait la liste filtrée du serveur alors que
  // le filtre paraît désactivé.
  useEffect(() => {
    if ((initialVieOnly && !vieFilter) || (initialMinScore > 0 && !minScore) || (initialNewOnly && !newOnly)) router.replace("/offres", { scroll: false });
  }, [initialVieOnly, vieFilter, initialMinScore, minScore, initialNewOnly, newOnly, router]);

  // Navigation vers /offres?score=N sans quitter la page : on active la puce de score.
  const initialScoreRef = useRef(initialMinScore);
  useEffect(() => {
    if (initialScoreRef.current === initialMinScore) return;
    initialScoreRef.current = initialMinScore;
    if (initialMinScore > 0) {
      setMinScore(true);
      setPage(1);
    }
  }, [initialMinScore]);

  const initialNewRef = useRef(initialNewOnly);
  useEffect(() => {
    if (initialNewRef.current === initialNewOnly) return;
    initialNewRef.current = initialNewOnly;
    setNewOnly(initialNewOnly);
    setPage(1);
  }, [initialNewOnly]);

  // router.refresh() après un scan apporte un nouveau résultat sans perdre les filtres actifs.
  useEffect(() => {
    if (initialRef.current === initialResult) return;
    initialRef.current = initialResult;
    setPage(1);
    if (hasFilters || sortBy !== "smart") setRefreshKey((key) => key + 1);
    else setResult(initialResult);
  }, [initialResult, hasFilters, sortBy]);

  useEffect(() => {
    if (firstRequest.current) { firstRequest.current = false; return; }
    const controller = new AbortController();
    const params = new URLSearchParams({ page: String(page), sort: sortBy });
    if (query) params.set("q", query);
    if (source) params.set("source", source);
    if (country) params.set("country", country);
    if (contractKey) params.set("contracts", contractKey);
    if (minScore) params.set("minScore", String(scoreThreshold));
    if (radius !== null) params.set("radius", String(radius));
    if (radius !== null && includeUnlocated) params.set("unlocated", "1");
    if (newOnly) params.set("new", "1");
    setLoading(true);
    setError(false);
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/offres/search?${params}`, { signal: controller.signal, cache: "no-store" });
        if (!response.ok) throw new Error("Recherche indisponible");
        const next = await response.json() as OffersSearch;
        setResult((current) => {
          if (page === 1) return next;
          // Un scan peut décaler le classement entre deux pages : jamais deux fois la même offre.
          const known = new Set(current.offers.map((offer) => offer.id));
          return { ...next, offers: [...current.offers, ...next.offers.filter((offer) => !known.has(offer.id))] };
        });
      } catch {
        if (!controller.signal.aborted) setError(true);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, page > 1 ? 0 : query ? 250 : 0);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [query, source, country, contractKey, minScore, scoreThreshold, sortBy, radius, includeUnlocated, page, refreshKey]);
  }, [query, source, country, contractKey, minScore, newOnly, scoreThreshold, sortBy, page, refreshKey]);

  function reset() {
    setQuery(""); setSource(""); setCountry(""); setContracts(new Set()); setMinScore(false); setRadius(null); setIncludeUnlocated(false); setSelectedId(null); setFiltersExpanded(false); setPage(1);
  }

  useEffect(() => {
    if (home) return;
    if (radius !== null) setRadius(null);
    if (includeUnlocated) setIncludeUnlocated(false);
    if (sortBy === "distance") setSortBy("smart");
  }, [home, radius, includeUnlocated, sortBy]);

  /** Nouvelle ville de référence (ou aucune) : les distances changent, on redemande la liste. */
  function onHomeSaved(next: HomeCommune | null) {
    if (!next) {
      setRadius(null);
      setIncludeUnlocated(false);
      if (sortBy === "distance") setSortBy("smart");
    }
    setPage(1);
    setRefreshKey((key) => key + 1);
    setQuery(""); setSource(""); setCountry(""); setContracts(new Set()); setMinScore(false); setNewOnly(false); setSelectedId(null); setFiltersExpanded(false); setPage(1);
  }

  function toggleContract(contract: ContractCategory) {
    setPage(1);
    setContracts((previous) => {
      const next = new Set(previous);
      if (next.has(contract)) next.delete(contract); else next.add(contract);
      return next;
    });
  }

  return (
    <div aria-busy={loading}>
      <section aria-label="Rechercher et filtrer les offres" className="glass-panel p-4 sm:p-5">
        <div className="flex flex-col gap-3 md:flex-row">
          <label className="relative flex-1">
            <span className="sr-only">Rechercher une offre</span>
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-textSecondary" />
            <input value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder="Poste, entreprise, compétence…"
              className="glass-inset h-12 w-full rounded-[14px] pl-10 pr-3 text-body text-text placeholder:text-textSecondary focus:border-accent focus:outline-none focus:ring-[3px] focus:ring-accent/15" />
          </label>
          <label className="glass-inset flex min-w-[170px] items-center gap-2 rounded-[14px] px-3 text-small text-textSecondary">
            <span>Trier par</span>
            <select value={sortBy} onChange={(event) => { setSortBy(event.target.value as OffersSort); setPage(1); }} className="h-12 min-w-0 flex-1 bg-transparent font-semibold text-text focus:outline-none" aria-label="Trier les offres">
              <option value="smart">Pertinence</option>
              <option value="newest">Plus récentes</option>
              <option value="oldest">Plus anciennes</option>
              <option value="score">Meilleur score</option>
              <option value="distance" disabled={!home}>{home ? "Plus proches" : "Plus proches (ville à définir)"}</option>
            </select>
          </label>
        </div>

        <button type="button" onClick={() => setFiltersExpanded((expanded) => !expanded)} aria-expanded={filtersExpanded} aria-controls="offres-filtres" className="mt-3 flex h-10 w-full items-center gap-2 rounded-md border border-border bg-bg px-3 text-small font-semibold md:hidden">
          <SlidersHorizontal className="h-4 w-4" /> Filtres {activeFilterCount > 0 && <span className="rounded-md bg-accent px-1.5 py-0.5 text-caption text-onAccent tabular-nums">{activeFilterCount}</span>}
          <ChevronDown className={cn("ml-auto h-4 w-4 transition-transform", filtersExpanded && "rotate-180")} />
        </button>
        <div id="offres-filtres" className={cn(filtersExpanded ? "block" : "hidden", "md:block")}>
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-4">
          <span className="mr-1 hidden items-center gap-1.5 text-small font-semibold text-textSecondary md:inline-flex"><SlidersHorizontal className="h-4 w-4" /> Filtres</span>
          {CONTRACT_ORDER.filter((contract) => contractCounts[contract] > 0 || contracts.has(contract)).map((contract) => (
            <Chip key={contract} active={contracts.has(contract)} onClick={() => toggleContract(contract)}>
              {CONTRACT_LABELS[contract]} <span className="font-normal tabular-nums">{numberFormat.format(contractCounts[contract])}</span>
            </Chip>
          ))}
          <Chip active={minScore} onClick={() => { setMinScore(!minScore); setPage(1); }}>Score {scoreThreshold}+</Chip>
          <Chip active={newOnly} onClick={() => { setNewOnly(!newOnly); setPage(1); }}>Nouvelles</Chip>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <select value={source} onChange={(event) => { setSource(event.target.value); setPage(1); }} aria-label="Filtrer par source" className="h-9 max-w-full rounded-md border border-border bg-bg px-3 text-small text-text focus:border-accent focus:outline-none">
            <option value="">Toutes les sources</option>
            {sources.map((item) => <option key={item} value={item}>{sourceLabels[item] ?? item}</option>)}
          </select>
          <select value={country} onChange={(event) => { setCountry(event.target.value); setPage(1); }} aria-label="Filtrer par pays" className="h-9 max-w-full rounded-md border border-border bg-bg px-3 text-small text-text focus:border-accent focus:outline-none">
            <option value="">Tous les pays</option>
            {countries.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </div>

        <div role="group" aria-label="Distance" className="mt-3 flex flex-wrap items-center gap-2">
          <DistanceHomePicker home={home} suggestion={home ? null : homeSuggestion} active={radius !== null || sortBy === "distance"} onSaved={onHomeSaved} />
          <select
            value={radius === null ? "" : String(radius)}
            disabled={!home}
            onChange={(event) => { setRadius(event.target.value === "" ? null : Number(event.target.value)); setPage(1); }}
            aria-label="Filtrer par distance"
            title={home ? undefined : "Définissez d'abord votre ville"}
            className="h-9 max-w-full rounded-md border border-border bg-bg px-3 text-small text-text focus:border-accent focus:outline-none disabled:opacity-50"
          >
            <option value="">Toutes distances</option>
            {DISTANCE_RADII.map((item) => (
              <option key={item} value={item}>{radiusLabel(item)}{home ? ` · ${numberFormat.format(distanceFacets.counts[String(item)] ?? 0)}` : ""}</option>
            ))}
          </select>
          {radius !== null && distanceFacets.unlocated > 0 && (
            <span className="text-caption text-textSecondary">
              {includeUnlocated
                ? `Dont ${numberFormat.format(distanceFacets.unlocated)} offre${distanceFacets.unlocated > 1 ? "s" : ""} en France sans ville précise.`
                : `${numberFormat.format(distanceFacets.unlocated)} offre${distanceFacets.unlocated > 1 ? "s" : ""} en France sans ville précise (télétravail, lieu non indiqué) non comptée${distanceFacets.unlocated > 1 ? "s" : ""}.`}{" "}
              <button type="button" onClick={() => { setIncludeUnlocated(!includeUnlocated); setPage(1); }} className="font-semibold text-accent hover:underline">
                {includeUnlocated ? "Les retirer" : "Les inclure"}
              </button>
            </span>
          )}
          {hasFilters && <button type="button" onClick={reset} className="inline-flex h-9 items-center gap-1.5 px-2 text-small font-semibold text-accent hover:underline"><RotateCcw className="h-3.5 w-3.5" /> Effacer les filtres</button>}
        </div>
        </div>
      </section>

      <div className="mb-4 mt-8 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="font-display text-h2">{hasFilters ? "Résultats de la recherche" : "Toutes les offres"}</h2>
          <p className="mt-1 text-small text-textSecondary" aria-live="polite">{resultLabel(result.total, hasFilters)}</p>
        </div>
        {result.total > result.pageSize && <span className="text-small text-textSecondary">{numberFormat.format(shown.length)} affichée{shown.length > 1 ? "s" : ""}</span>}
      </div>

      {error && <p role="alert" className="mb-4 text-small text-danger">La recherche n’a pas pu être actualisée. <button type="button" onClick={() => setRefreshKey((key) => key + 1)} className="font-semibold underline">Réessayer</button></p>}

      {result.total === 0 ? (
        <div className="glass-panel px-6 py-14 text-center">
          <Briefcase className="mx-auto mb-4 h-8 w-8 text-accent" />
          <h3 className="font-display text-h2">{result.facets.total === 0 ? "Votre recherche commence ici" : "Aucune offre pour ces critères"}</h3>
          <p className="mx-auto mt-2 max-w-[42ch] text-body text-textSecondary">{result.facets.total === 0 ? "Lancez un scan pour découvrir des offres liées à votre profil." : "Essayez un autre mot clé ou retirez un filtre pour élargir les résultats."}</p>
          {hasFilters && <button type="button" onClick={reset} className="mt-5 text-small font-semibold text-accent hover:underline">Voir toutes les offres</button>}
        </div>
      ) : (
        <div className={cn("grid items-start gap-5 transition-opacity xl:grid-cols-[minmax(0,1fr)_minmax(360px,0.9fr)]", loading && "opacity-60")}>
          <div className="min-w-0">
            <div className="glass-panel overflow-hidden">
              {shown.map((offer) => <OfferRow key={offer.id} offer={offer} selected={selected?.id === offer.id} onSelect={() => setSelectedId(offer.id)} />)}
            </div>
            {remaining > 0 && (
              <div className="mt-5 text-center">
                <button type="button" disabled={loading || error} onClick={() => setPage((current) => current + 1)} className="button-secondary h-11 rounded-full px-6 text-small font-medium transition-colors disabled:opacity-50">
                  {loading ? "Chargement…" : `Afficher davantage · ${numberFormat.format(remaining)} restante${remaining > 1 ? "s" : ""}`}
                </button>
              </div>
            )}
          </div>
          {selected && <OfferPreview key={selected.id} offer={selected} />}
        </div>
      )}
    </div>
  );
}

/** Lieu reconnu par JobScout, montré s'il est approximatif ou absent du texte de l'offre (sinon : null). */
function understoodPlace(offer: OffreSummary): string | null {
  if (!offer.geo_label || offer.distance_km === null) return null;
  if (isApproximate(offer.geo_precision)) return `${offer.geo_label} ?`;
  return offer.location ? null : offer.geo_label;
}

function OfferRow({ offer, selected, onSelect }: { offer: OffreSummary; selected: boolean; onSelect: () => void }) {
  const classes = "offer-row group w-full items-start gap-3.5 border-b border-border border-l-[3px] p-4 text-left last:border-b-0 sm:gap-4 sm:p-5";
  return (
    <>
      <button type="button" onClick={onSelect} aria-current={selected ? "true" : undefined} className={cn(classes, "hidden border-l-transparent xl:flex")}>
        <OfferRowContent offer={offer} />
      </button>
      <Link href={`/offres/${offer.id}`} className={cn(classes, "flex border-l-transparent xl:hidden")}>
        <OfferRowContent offer={offer} />
      </Link>
    </>
  );
}

function OfferRowContent({ offer }: { offer: OffreSummary }) {
  const score = scoreColor(offer.score ?? 0);
  return (
    <>
      <span className="score-badge flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-[15px] text-[19px] font-semibold leading-none tabular-nums" data-tone={score.tone} aria-label={`Score ${offer.score ?? 0} sur 100, ${score.label.toLowerCase()}`}>
        {offer.score ?? 0}<span className="mt-0.5 text-[11px] font-medium">/ 100</span>
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-medium leading-snug group-hover:text-accent">{offer.title}</span>
        <span className="mt-1 block text-small text-textSecondary">
          {offer.company || "Entreprise non précisée"} · {offer.location || offer.country || "Lieu non précisé"}
          {understoodPlace(offer) && <span> · {understoodPlace(offer)}</span>}
          {distanceLabel(offer) && <span className="whitespace-nowrap font-semibold text-text"> · {distanceLabel(offer)}</span>}
        </span>
        <span className="mt-3 flex flex-wrap items-center gap-1.5">
          {offer.posted_at && <span className="mr-1 text-caption text-textSecondary">{formatRelativeDate(offer.posted_at)}</span>}
          <Badge>{sourceLabels[offer.source] ?? offer.source}</Badge>
          {offer.contract_category !== "autre" && <Badge variant={offer.contract_category === "vie" ? "info" : "default"}>{CONTRACT_LABELS[offer.contract_category]}</Badge>}
          {(offer.has_cv || offer.has_lm) && <Badge variant="success">Dossier prêt</Badge>}
          {offer.description_status === "failed" && <Badge variant="warning">Annonce partielle</Badge>}
        </span>
      </span>
      <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-textSecondary group-hover:text-accent xl:hidden" />
    </>
  );
}

function OfferPreview({ offer }: { offer: OffreSummary }) {
  const score = scoreColor(offer.score ?? 0);
  // Décodage garde-fou et coupe : lib/offres/preview.ts (testé).
  const excerpt = previewExcerpt(offer.description_text);
  return (
    <aside aria-label={`Aperçu : ${offer.title}`} className="glass-panel focus-card page-enter sticky top-6 hidden p-6 xl:block">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="eyebrow"><span className="signal-dot !h-1 !w-1" aria-hidden="true" />Aperçu de l’offre</span>
        <Badge>{sourceLabels[offer.source] ?? offer.source}</Badge>
      </div>
      <div className="mt-6 flex items-start gap-4">
        <div className="min-w-0 flex-1">
          <p className="text-small font-semibold text-accent">{offer.company || "Entreprise non précisée"}</p>
          <h3 className="mt-2 font-display text-[clamp(1.5rem,2vw,1.9rem)] font-medium leading-[1.25]">{offer.title}</h3>
        </div>
        <span className="score-badge flex h-16 w-16 shrink-0 flex-col items-center justify-center rounded-[20px] text-[26px] font-semibold leading-none tabular-nums" data-tone={score.tone} aria-label={`Score ${offer.score ?? 0} sur 100, ${score.label.toLowerCase()}`}>
          {offer.score ?? 0}<span className="mt-1 text-[11px] font-semibold">/ 100</span>
        </span>
      </div>
      <div className="mt-5 flex flex-wrap gap-x-4 gap-y-2 border-b border-border pb-5 text-small text-textSecondary">
        {(offer.location || offer.country) && (
          <span className="inline-flex items-start gap-1.5">
            <MapPin className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              {offer.location || offer.country}
              {understoodPlace(offer) && <> · lieu compris : {understoodPlace(offer)}</>}
              {distanceLabel(offer) && <span className="whitespace-nowrap font-semibold text-text"> · {offer.same_city || offer.same_dept ? distanceLabel(offer) : `${distanceLabel(offer)} à vol d’oiseau`}</span>}
            </span>
          </span>
        )}
        {offer.posted_at && <span className="inline-flex items-center gap-1.5"><CalendarDays className="h-4 w-4" /> {formatRelativeDate(offer.posted_at)}</span>}
        {offer.contract_category !== "autre" && <span>{CONTRACT_LABELS[offer.contract_category]}</span>}
      </div>
      <div className="py-5">
        <p className="text-small font-semibold">Pourquoi cette offre ?</p>
        <p className="mt-1 line-clamp-3 text-small leading-relaxed text-textSecondary">{offer.score_reason || `Score ${score.label.toLowerCase()} pour votre profil.`}</p>
      </div>
      <div className="border-t border-border py-5">
        <p className="text-small font-semibold">En bref</p>
        <p className="mt-2 line-clamp-5 text-small leading-relaxed text-textSecondary">{offer.description_status === "failed" || !excerpt ? "La description n'est pas disponible ici. Consultez l'annonce d'origine pour en savoir plus." : excerpt}</p>
      </div>
      <div className="space-y-2 border-t border-border pt-5">
        <Link href={`/offres/${offer.id}`} className="button-primary flex min-h-11 items-center justify-center gap-2 rounded-full px-4 text-center text-small font-medium">Voir l’offre et préparer le dossier <ArrowRight className="h-4 w-4 shrink-0" /></Link>
        <a href={offer.url} target="_blank" rel="noopener noreferrer" className="flex h-10 items-center justify-center gap-2 text-small font-semibold text-accent hover:underline">Annonce d’origine <ArrowUpRight className="h-4 w-4" /></a>
      </div>
    </aside>
  );
}
