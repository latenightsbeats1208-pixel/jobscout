import Link from "next/link";
import { getDb } from "@/lib/db";
import { listOffres, offresCounts } from "@/lib/db/offres";
import { listCandidatures, candidaturesCounts } from "@/lib/db/candidatures";
import { getProfile } from "@/lib/db/queries";
import { PageHeader } from "@/components/app/page-header";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Calendar, ArrowRight } from "lucide-react";
import { formatRelativeDate, scoreColor } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const profile = getProfile();
  const offresAll = listOffres();
  const offresTop = offresAll.slice(0, 6);
  const counts = offresCounts();
  const candidatures = listCandidatures();
  const candCounts = candidaturesCounts();

  const upcoming = candidatures
    .filter((c) => c.deadline && new Date(c.deadline) >= new Date(Date.now() - 86400000))
    .sort((a, b) => (a.deadline! > b.deadline! ? 1 : -1))
    .slice(0, 5);

  return (
    <>
      <PageHeader
        title={profile?.full_name ? `Bonjour, ${profile.full_name.split(" ")[0]}` : "Dashboard"}
        subtitle="Vue d'ensemble de votre recherche d'emploi."
      />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mb-10">
        <StatCard label="Offres disponibles" value={counts.total} sub={`${counts.today} aujourd'hui`} href="/offres" />
        <StatCard label="Candidatures envoyées" value={candCounts.total} sub={`${candCounts.upcoming} échéances`} href="/candidatures" />
        <StatCard label="V.I.E disponibles" value={counts.vie} sub="Civiweb / Business France" href="/offres?vie=1" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Card>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-h3">Échéances à venir</h2>
            <Link href="/candidatures" className="text-small text-accent hover:underline">
              Tout voir
            </Link>
          </div>
          {upcoming.length === 0 ? (
            <p className="text-small text-textSecondary py-4">Aucune échéance enregistrée.</p>
          ) : (
            <div className="space-y-2">
              {upcoming.map((c) => (
                <div key={c.id} className="flex items-center justify-between p-3 rounded-md hover:bg-surface">
                  <div className="flex items-center gap-3">
                    <div className="h-9 w-9 rounded-md bg-warning/15 text-warning flex items-center justify-center">
                      <Calendar className="h-4 w-4" />
                    </div>
                    <div>
                      <p className="text-body font-medium">{c.offre_title ?? c.ext_title}</p>
                      <p className="text-small text-textSecondary">
                        {c.offre_company ?? c.ext_company} · {c.deadline}
                      </p>
                    </div>
                  </div>
                  <Badge variant="warning">{c.status}</Badge>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-h3">Nouvelles offres</h2>
            <Link href="/offres" className="text-small text-accent hover:underline">
              Tout voir
            </Link>
          </div>
          {offresTop.length === 0 ? (
            <p className="text-small text-textSecondary py-4">Lancez un scan depuis l'onglet Offres.</p>
          ) : (
            <div className="space-y-2">
              {offresTop.map((o) => {
                const sc = scoreColor(o.score ?? 0);
                return (
                  <Link
                    key={o.id}
                    href={`/offres/${o.id}`}
                    className="flex items-center gap-3 p-3 rounded-md hover:bg-surface group"
                  >
                    <span
                      className="shrink-0 h-9 w-9 rounded-md flex items-center justify-center text-small font-semibold"
                      style={{ background: sc.bg, color: sc.fg }}
                    >
                      {o.score ?? 0}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-body font-medium truncate">{o.title}</p>
                      <p className="text-small text-textSecondary truncate">
                        {o.company} · {o.country ?? ""} {o.posted_at ? `· ${formatRelativeDate(o.posted_at)}` : ""}
                      </p>
                    </div>
                    <ArrowRight className="h-4 w-4 text-textSecondary opacity-0 group-hover:opacity-100 transition-opacity" />
                  </Link>
                );
              })}
            </div>
          )}
        </Card>
      </div>
    </>
  );
}

function StatCard({
  label,
  value,
  sub,
  href,
}: {
  label: string;
  value: number;
  sub: string;
  href: string;
}) {
  return (
    <Link href={href}>
      <Card className="hover:shadow-elevated transition-shadow">
        <p className="text-caption uppercase tracking-wide text-textSecondary">{label}</p>
        <p className="text-display mt-2 mb-1 tracking-tight">{value}</p>
        <p className="text-small text-textSecondary">{sub}</p>
      </Card>
    </Link>
  );
}
