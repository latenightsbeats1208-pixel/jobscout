import Link from "next/link";
import { ArrowRight, ArrowUpRight, Briefcase, CalendarClock, CalendarDays, Clock, FileText, Gauge, Globe, MapPin, Search, Send, Sparkles, type LucideIcon } from "lucide-react";
import { ScoreOrbit } from "@/components/app/score-orbit";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { suggestedOffres, offresCounts, newOffersFromLastScan, newOffersFromLastScanCount } from "@/lib/db/offres";
import { listCandidatures, candidaturesCounts, upcomingDeadlines, searchReport } from "@/lib/db/candidatures";
import { listDocuments } from "@/lib/db/documents";
import { highScoreFigure, untrackedOffresCount, vieFigure } from "@/lib/db/dashboard";
import { getProfile } from "@/lib/db/queries";
import { formatRelativeDate, scoreColor } from "@/lib/utils";

export const dynamic = "force-dynamic";

// Mêmes libellés et variantes que la page Candidatures (les couleurs viennent de Badge).
const STATUS_META: Record<string, { label: string; variant: BadgeVariant }> = {
  envoyee: { label: "Envoyée", variant: "info" },
  en_cours: { label: "En cours", variant: "warning" },
  entretien: { label: "Entretien", variant: "warning" },
  acceptee: { label: "Acceptée", variant: "success" },
  refusee: { label: "Refusée", variant: "danger" },
};

const HIGH_SCORE = 70;

function plural(n: number, singular: string, pluralForm = `${singular}s`): string {
  return `${n.toLocaleString("fr-FR")} ${n > 1 ? pluralForm : singular}`;
}

export default async function DashboardPage() {
  const profile = getProfile();
  const untrackedOffers = suggestedOffres(6, true);
  const fallbackOffers = suggestedOffres(7);
  const counts = offresCounts();
  const candidatures = listCandidatures();
  const candCounts = candidaturesCounts();
  const deadlines = upcomingDeadlines(5);
  const newOffers = newOffersFromLastScan(5);
  const newOffersCount = newOffersFromLastScanCount();
  const report = searchReport(30);
  const documents = listDocuments();
  const untrackedCount = untrackedOffresCount();
  // D4 : carte V.I.E pour un profil qui en cherche (même détection que la 3.5.0 : contrats recherchés),
  // sinon les offres les mieux classées.
  const wantsVie = profile?.preferred_contracts?.includes("vie") ?? false;
  const thirdFigure = wantsVie ? vieFigure() : highScoreFigure(HIGH_SCORE);
  const firstName = profile?.full_name?.trim().split(/\s+/)[0] || null;
  const nextOffer = untrackedOffers[0] ?? fallbackOffers[0] ?? null;
  const nextIsUntracked = !!nextOffer && untrackedOffers[0]?.id === nextOffer.id;
  const otherOffers = (untrackedOffers.length > 1 ? untrackedOffers : fallbackOffers).filter((offer) => offer.id !== nextOffer?.id);
  const topOffers = (otherOffers.length ? otherOffers : fallbackOffers).slice(0, 5);
  const dossierCount = new Set(documents.map((doc) => doc.offre_id).filter((id): id is number => id != null)).size;
  const published = nextOffer ? publishedLabel(nextOffer.posted_at) : null;
  const today = new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long" }).format(new Date());

  return (
    <div className="space-y-7 sm:space-y-8">
      <header className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="eyebrow mb-3"><span className="signal-dot" aria-hidden="true" />Vue d’ensemble</p>
          <h1 className="font-display text-display text-balance">Bonjour{firstName ? `, ${firstName}` : ""}.</h1>
          <p className="mt-3 max-w-[60ch] text-body text-textSecondary">
            {plural(untrackedCount, "offre")} hors de votre suivi · {plural(dossierCount, "dossier préparé", "dossiers préparés")}
          </p>
        </div>
        <span className="inline-flex w-fit items-center gap-2 rounded-full border border-border px-3.5 py-2 text-caption text-textSecondary sm:mb-1"><CalendarDays className="h-3.5 w-3.5" /><span className="first-letter:uppercase">{today}</span></span>
      </header>

      <section aria-label="Prochaine étape" className="glass-panel focus-card reveal-panel">
        <div className="relative grid items-center md:grid-cols-[minmax(0,1fr)_300px] xl:grid-cols-[minmax(0,1fr)_340px]">
          <div className="relative z-10 p-6 sm:p-8 xl:p-9">
            <span className="inline-flex items-center gap-2 rounded-full border border-accent/30 px-3 py-1.5 text-caption font-medium text-text"><span className="signal-dot !h-1 !w-1" aria-hidden="true" />À découvrir maintenant</span>
            <h2 className="mt-5 max-w-[25ch] font-display text-[clamp(1.65rem,2.5vw,2.3rem)] font-medium leading-[1.24]">
              {nextOffer ? nextOffer.title : "Commencez par découvrir les offres."}
            </h2>
            <p className="mt-3 text-body text-textSecondary">
              {nextOffer ? nextOffer.company || "Entreprise non précisée" : "Lancez une recherche pour trouver des postes adaptés à votre profil."}
            </p>
            {nextOffer && (
              <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-small text-textSecondary">
                <span className="inline-flex items-center gap-1.5"><MapPin className="h-3.5 w-3.5" />{nextOffer.location || nextOffer.country || "Lieu non précisé"}</span>
                <span className="inline-flex items-center gap-1.5"><Clock className="h-3.5 w-3.5" />{published ?? "Date de publication non précisée"}</span>
              </p>
            )}
            <Link href={nextOffer ? `/offres/${nextOffer.id}` : "/offres"} className="button-primary group mt-7 inline-flex min-h-11 items-center justify-center gap-5 rounded-full py-2.5 pl-5 pr-4 text-small font-medium">
              {nextOffer ? "Étudier cette offre" : "Explorer les offres"} <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </Link>
          </div>
          <div className="flex items-center justify-center gap-6 border-t border-accent/10 px-6 py-6 sm:gap-4 md:flex-col md:border-t-0 md:px-4 md:py-7">
            {nextOffer ? (
              <>
                <ScoreOrbit score={nextOffer.score ?? 0} />
                <div className="max-w-[180px] md:max-w-none md:text-center">
                  <p className="text-small font-medium">Adéquation avec votre profil</p>
                  <p className="mt-1 text-caption text-textSecondary">
                    {nextIsUntracked ? `En tête parmi ${plural(untrackedCount, "offre")} hors de votre suivi` : "Toutes les offres sont déjà dans votre suivi"}
                  </p>
                </div>
              </>
            ) : (
              <p className="text-small text-textSecondary">Vos prochaines opportunités apparaîtront ici après une recherche.</p>
            )}
          </div>
        </div>
      </section>

      <section aria-label="Chiffres clés" className="reveal-panel reveal-delay-1 grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4">
        <Metric icon={Briefcase} label="Offres disponibles" value={counts.total} detail={`${counts.today.toLocaleString("fr-FR")} publiée${counts.today > 1 ? "s" : ""} aujourd'hui`} href="/offres" />
        <Metric icon={Send} label="Candidatures" value={candCounts.total} detail={candCounts.upcoming ? `${plural(candCounts.upcoming, "échéance")} à venir` : "Aucune échéance à venir"} href="/candidatures" />
        {wantsVie
          ? <Metric icon={Globe} label="V.I.E" value={thirdFigure.total} detail={`dont ${thirdFigure.recent.toLocaleString("fr-FR")} publié${thirdFigure.recent > 1 ? "s" : ""} ces 7 derniers jours`} href="/offres?vie=1" />
          : <Metric icon={Gauge} label={`Offres à ${HIGH_SCORE} et plus`} value={thirdFigure.total} detail={`dont ${thirdFigure.recent.toLocaleString("fr-FR")} publiée${thirdFigure.recent > 1 ? "s" : ""} ces 7 derniers jours`} href={`/offres?score=${HIGH_SCORE}`} />}
      </section>

      <section aria-label="Nouvelles offres depuis le dernier scan" className="glass-panel overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4 sm:px-6">
          <div>
            <h2 className="flex items-center gap-2 font-display text-[19px] font-medium"><Sparkles className="h-4 w-4 text-accent" />Nouvelles depuis le dernier scan</h2>
            <p className="mt-1 text-caption text-textSecondary">{newOffersCount ? plural(newOffersCount, "offre découverte") : "Aucune nouvelle offre au dernier scan"}</p>
          </div>
          <Link href="/offres?new=1" className="inline-flex items-center gap-1 text-caption font-medium text-textSecondary hover:text-accent">Voir toutes les nouveautés <ArrowUpRight className="h-3.5 w-3.5" /></Link>
        </div>
        {newOffers.length ? (
          <ul>
            {newOffers.map((offer) => (
              <li key={offer.id} className="border-b border-border last:border-0">
                <Link href={`/offres/${offer.id}`} className="offer-row group flex items-center gap-3 px-5 py-3.5 sm:px-6">
                  <Badge variant="info">Nouveau</Badge>
                  <span className="min-w-0 flex-1">
                    <span className="block line-clamp-1 text-small font-medium">{offer.title}</span>
                    <span className="mt-0.5 block truncate text-caption text-textSecondary">{offer.company || "Entreprise non précisée"} · {offer.location || offer.country || "Lieu non précisé"}</span>
                  </span>
                  <span className="shrink-0 text-small font-semibold tabular-nums">{offer.score}/100</span>
                  <ArrowRight className="h-4 w-4 shrink-0 text-textSecondary transition-transform group-hover:translate-x-1 group-hover:text-accent" />
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-5 py-5 text-small text-textSecondary sm:px-6">Les offres ajoutées lors d’un scan apparaîtront ici.</p>
        )}
      </section>

      <section aria-labelledby="search-report-title" className="glass-panel p-5 sm:p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="search-report-title" className="font-display text-[19px] font-medium">Votre bilan de recherche</h2>
          <span className="text-caption text-textSecondary">Candidatures ajoutées sur les 30 derniers jours</span>
        </div>
        <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <ReportMetric label="Candidatures" value={report.total} />
          <ReportMetric label="En entretien" value={report.interviews} />
          <ReportMetric label="Avec une réponse" value={report.responses} detail={`${report.responseRate} %`} />
          <ReportMetric label="Décisions" value={report.accepted + report.refused} detail={`${report.accepted} acceptée${report.accepted === 1 ? "" : "s"} · ${report.refused} refusée${report.refused === 1 ? "" : "s"}`} />
        </div>
      </section>

      <div className="reveal-panel reveal-delay-2 grid items-start gap-5 xl:grid-cols-[minmax(0,1.5fr)_minmax(290px,0.85fr)]">
        <section aria-labelledby="recommended-title" className="glass-panel min-w-0 overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-5 sm:px-6">
            <div>
              <h2 id="recommended-title" className="font-display text-[19px] font-medium">À explorer pour vous</h2>
            </div>
            <Link href="/offres" className="inline-flex shrink-0 items-center gap-1 text-caption font-medium text-textSecondary hover:text-accent">Tout voir <ArrowUpRight className="h-3.5 w-3.5" /></Link>
          </div>
          <div>
            {topOffers.length ? topOffers.map((offer) => {
              // Code couleur du score (comme en 3.4.10) : fond teinté et encre ≥ 4,5:1 fournis par scoreColor.
              const sc = scoreColor(offer.score ?? 0);
              return (
                <Link key={offer.id} href={`/offres/${offer.id}`} className="offer-row group flex items-center gap-3.5 border-b border-border px-5 py-4 last:border-b-0 sm:px-6">
                  <span className="flex h-11 w-11 shrink-0 flex-col items-center justify-center rounded-[14px] text-[17px] font-semibold leading-none tabular-nums" style={{ background: sc.bg, color: sc.fg }} aria-label={`Score ${offer.score ?? 0} sur 100, ${sc.label}`}>
                    {offer.score ?? 0}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block line-clamp-2 text-small font-medium leading-snug">{offer.title}</span>
                    <span className="mt-1 block truncate text-caption text-textSecondary">{offer.company || "Entreprise non précisée"} · {offer.country || "Pays non précisé"}{offer.posted_at ? ` · ${formatRelativeDate(offer.posted_at)}` : ""}</span>
                  </span>
                  <ArrowRight className="h-4 w-4 shrink-0 text-textSecondary transition-transform group-hover:translate-x-1 group-hover:text-accent" />
                </Link>
              );
            }) : (
              <div className="px-6 py-12 text-center">
                <Search className="mx-auto mb-3 h-7 w-7 text-accent" />
                <h3 className="text-h3">Vos offres apparaîtront ici</h3>
                <p className="mx-auto mt-2 max-w-[36ch] text-small text-textSecondary">Lancez un scan depuis la page Offres pour remplir votre sélection.</p>
                <Link href="/offres" className="mt-4 inline-flex items-center gap-1 text-small font-semibold text-accent hover:underline">Aller aux offres <ArrowRight className="h-4 w-4" /></Link>
              </div>
            )}
          </div>
        </section>

        <div className="space-y-6">
          <section aria-labelledby="deadlines-title" className="glass-panel overflow-hidden">
            <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-5">
              <div>
                <h2 id="deadlines-title" className="font-display text-[19px] font-medium">Rappels et échéances</h2>
                <p className="mt-0.5 text-caption text-textSecondary">{candCounts.upcoming ? `${plural(candCounts.upcoming, "rappel ou échéance")} à venir` : "Aucun rappel ou échéance à venir"}</p>
              </div>
              <Link href="/candidatures" className="inline-flex items-center gap-1 text-caption font-medium text-textSecondary hover:text-accent">Le suivi <ArrowUpRight className="h-3.5 w-3.5" /></Link>
            </div>
            <div className="p-5">
              {deadlines.length ? (
                <ol className="space-y-3" aria-label="Échéances par date">
                  {deadlines.map((d) => {
                    const date = new Date(`${d.deadline.slice(0, 10)}T12:00:00`);
                    const status = STATUS_META[d.status];
                    return (
                      <li key={d.id} className="flex items-start gap-3 border-b border-border pb-3 last:border-0 last:pb-0">
                        <span className="flex w-12 shrink-0 flex-col items-center rounded-[12px] border border-border py-1.5 text-center leading-none">
                          <span className="font-display text-[19px] font-medium tabular-nums">{date.getDate()}</span>
                          <span className="mt-1 text-caption text-textSecondary">{date.toLocaleDateString("fr-FR", { month: "short" })}</span>
                        </span>
                        <span className="min-w-0 flex-1">
                          {d.offre_id
                            ? <Link href={`/offres/${d.offre_id}`} className="block line-clamp-2 text-small font-semibold leading-snug hover:text-accent">{d.title ?? "Poste non précisé"}</Link>
                            : <span className="block line-clamp-2 text-small font-semibold leading-snug">{d.title ?? "Poste non précisé"}</span>}
                          <span className="mt-0.5 block truncate text-small text-textSecondary">{d.company ?? "Entreprise non précisée"}</span>
                          <span className="mt-1 flex items-center gap-1.5 text-caption text-textSecondary"><CalendarClock className="h-3.5 w-3.5 shrink-0" />{d.kind === "follow_up" ? `Relance : ${dueLabel(d.deadline, true)}` : `Échéance : ${dueLabel(d.deadline)}`}{status ? ` · ${status.label}` : ""}</span>
                        </span>
                      </li>
                    );
                  })}
                </ol>
              ) : (
                <p className="text-small text-textSecondary">Ajoutez une date de relance ou une échéance depuis le suivi : les actions à venir et les relances en retard s’afficheront ici.</p>
              )}
            </div>
          </section>

          <section aria-labelledby="activity-title" className="glass-panel overflow-hidden">
            <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-5">
              <div>
                <h2 id="activity-title" className="font-display text-[19px] font-medium">Votre activité</h2>
              </div>
              <Link href="/candidatures" className="inline-flex items-center gap-1 text-caption font-medium text-textSecondary hover:text-accent">Le suivi <ArrowUpRight className="h-3.5 w-3.5" /></Link>
            </div>
            <div className="p-5">
              {candidatures.length ? (
                <div className="space-y-4">
                  {candidatures.slice(0, 3).map((c) => {
                    const status = STATUS_META[c.status] ?? { label: c.status, variant: "default" as const };
                    return (
                      <div key={c.id} className="relative border-b border-border pb-4 pl-5 last:border-0 last:pb-0">
                        <span className="signal-dot absolute left-0 top-2 !h-1.5 !w-1.5" aria-hidden="true" />
                        <div className="flex items-start justify-between gap-3">
                          <p className="line-clamp-2 text-small font-semibold leading-snug">{c.offre_title || c.ext_title || "Candidature"}</p>
                          <Badge variant={status.variant} className="shrink-0">{status.label}</Badge>
                        </div>
                        <p className="mt-1 text-small text-textSecondary">{c.offre_company || c.ext_company || "Entreprise non précisée"}</p>
                        <p className="mt-2 text-caption text-textSecondary">Ajoutée le {displayDate(c.applied_at)}</p>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="py-5 text-center">
                  <CalendarDays className="mx-auto mb-3 h-6 w-6 text-textSecondary" />
                  <p className="text-small font-semibold">Votre suivi commence ici</p>
                  <p className="mx-auto mt-1 max-w-[32ch] text-small text-textSecondary">Ajoutez une offre au suivi pour retrouver son avancement et vos échéances.</p>
                </div>
              )}
            </div>
          </section>
          <Link href="/documents" className="glass-panel group flex items-center gap-4 p-5 transition-colors hover:border-accent/30">
            <span className="brand-mark h-12 w-12 rounded-[16px]"><FileText className="h-5 w-5" strokeWidth={1.5} /></span>
            <span className="min-w-0 flex-1">
              <span className="block text-small font-semibold">Vos documents</span>
              <span className="mt-0.5 block text-small text-textSecondary">{documents.length ? `${plural(documents.length, "fichier")} · ${plural(dossierCount, "dossier")}` : "Aucun document généré pour l’instant"}</span>
            </span>
            <ArrowUpRight className="h-4 w-4 text-textSecondary group-hover:text-accent" />
          </Link>
        </div>
      </div>
    </div>
  );
}

function displayDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(`${value.slice(0, 10)}T12:00:00`);
  return Number.isNaN(date.getTime()) ? value.slice(0, 10) : date.toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" });
}

/** « Publiée il y a 3 j » ou « Publiée le 12 sept. 2026 » ; null si la date est absente ou illisible. */
function publishedLabel(value: string | null): string | null {
  if (!value) return null;
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return null;
  const relative = formatRelativeDate(value);
  return relative.startsWith("il y a") && time <= Date.now() ? `Publiée ${relative}` : `Publiée le ${new Date(time).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" })}`;
}

/** Nombre de jours avant l'échéance, en jours calendaires locaux. */
function dueLabel(deadline: string, isFollowUp = false): string {
  const due = new Date(`${deadline.slice(0, 10)}T12:00:00`).getTime();
  const now = new Date();
  const todayNoon = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12).getTime();
  const days = Math.round((due - todayNoon) / 86_400_000);
  if (!Number.isFinite(days)) return "Date illisible";
  if (days < 0) return isFollowUp ? "en retard" : "dépassée";
  if (days === 0) return "Aujourd’hui";
  if (days === 1) return "Demain";
  return `Dans ${days} jours`;
}

function Metric({ icon: Icon, label, value, detail, href }: { icon: LucideIcon; label: string; value: number; detail: string; href: string }) {
  return (
    <Link href={href} className="glass-panel metric-card group flex items-center gap-4 px-5 py-4 transition-all duration-200 sm:block sm:px-6 sm:py-5">
      {/* Sous 640 px, le libellé tient sur une ligne : c'est le détail chiffré, à droite, qui passe à la ligne. */}
      <span className="flex flex-1 items-center gap-3 sm:gap-2.5">
        <Icon className="h-4 w-4 shrink-0 text-textSecondary" strokeWidth={1.5} />
        <span className="whitespace-nowrap text-small font-medium">{label}</span>
        <ArrowUpRight className="ml-auto hidden h-3.5 w-3.5 text-textSecondary opacity-40 transition-opacity group-hover:opacity-100 sm:block" />
      </span>
      <span className="relative z-10 flex min-w-0 flex-col text-right sm:mt-4 sm:text-left">
        <span className="font-display text-[32px] font-light leading-none tabular-nums sm:text-[42px]">{value.toLocaleString("fr-FR")}</span>
        <span className="mt-2 block text-caption text-textSecondary">{detail}</span>
      </span>
    </Link>
  );
}

function ReportMetric({ label, value, detail }: { label: string; value: number; detail?: string }) {
  return (
    <div className="rounded-[14px] border border-border px-4 py-3">
      <p className="font-display text-[30px] font-light leading-none tabular-nums">{value.toLocaleString("fr-FR")}</p>
      <p className="mt-2 text-caption font-medium">{label}</p>
      {detail && <p className="mt-1 text-caption text-textSecondary">{detail}</p>}
    </div>
  );
}
