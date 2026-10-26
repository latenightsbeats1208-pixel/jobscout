"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, Briefcase, FileText, FolderOpen, User, Search, LayoutTemplate } from "lucide-react";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "./theme-toggle";
import { VersionBadge } from "./version-badge";
import { QuotaBadge } from "./quota-badge";

const items = [
  { href: "/dashboard", label: "Accueil", icon: LayoutDashboard },
  { href: "/offres", label: "Offres", icon: Briefcase },
  { href: "/candidatures", label: "Candidatures", icon: FileText },
  { href: "/documents", label: "Documents", icon: FolderOpen },
  { href: "/cv-template", label: "Modèle CV", icon: LayoutTemplate },
  { href: "/profile", label: "Profil", icon: User },
];

export function Sidebar({
  version,
  productName = "JobScout",
  profileName,
}: {
  version: string;
  /** « JobScout Test » dans l'installeur de test — voir lib/update/check.ts. */
  productName?: string;
  profileName: string | null;
}) {
  const pathname = usePathname();
  const isActive = (href: string) => pathname === href || pathname?.startsWith(href + "/");
  const initials = profileName?.split(/\s+/).slice(0, 2).map((part) => part[0]?.toLocaleUpperCase("fr-FR")).join("") || "JS";
  return (
    <>
      {/* En-tête sous 1 024 px : la barre latérale (et ses pastilles de
          mise à jour et de quota) y est masquée, on les remonte ici. */}
      <header className="mobile-header sticky top-0 z-40 flex h-[72px] items-center justify-between gap-3 border-b border-border px-5 sm:px-8 lg:hidden">
        <Link href="/dashboard" className="flex shrink-0 items-center gap-2.5" aria-label="JobScout, accueil">
          <span className="brand-mark h-9 w-9 rounded-xl"><Search className="h-5 w-5" strokeWidth={1.75} /></span>
          <span className="font-display text-[22px] font-semibold leading-none">JobScout<span className="text-accent">.</span></span>
        </Link>
        <div className="flex min-w-0 items-center gap-1.5 sm:gap-2">
          <QuotaBadge compact />
          <VersionBadge version={version} productName={productName} compact />
          <ThemeToggle compact />
        </div>
      </header>

      <aside className="glass-panel workspace-sidebar fixed inset-y-[18px] left-[18px] z-30 hidden w-[236px] flex-col rounded-[26px] px-3 pb-4 pt-7 lg:flex">
        <Link href="/dashboard" className="mb-12 flex items-center gap-3 px-3" aria-label="JobScout, accueil">
          <span className="brand-mark h-10 w-10 rounded-[14px]"><Search className="h-[22px] w-[22px]" strokeWidth={1.75} /></span>
          <span>
            <span className="block font-display text-[23px] font-semibold leading-none">JobScout<span className="text-accent">.</span></span>
            <span className="mt-1.5 block text-[11px] font-medium tracking-wide text-textSecondary">Votre prochain chapitre</span>
          </span>
        </Link>
        <p className="mb-3 px-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-textSecondary">Espace personnel</p>
        <nav aria-label="Navigation principale" className="flex flex-col gap-1.5">
          {items.map((item) => {
            const active = isActive(item.href);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className="nav-item group relative flex h-12 items-center gap-3 rounded-[14px] px-3 text-small font-medium"
              >
                <Icon className="h-[18px] w-[18px]" strokeWidth={1.65} />
                {item.label}
                {active && <span aria-hidden="true" className="signal-dot ml-auto !h-1 !w-1" />}
              </Link>
            );
          })}
        </nav>
        <div className="mt-auto space-y-2 pt-6">
          <Link href="/profile" className="glass-inset mb-3 flex items-center gap-3 rounded-[16px] p-3 transition-colors hover:bg-surfaceHover">
            <span className="brand-mark h-9 w-9 rounded-full text-small font-semibold text-accent">{initials}</span>
            <span className="min-w-0"><span className="block truncate text-small font-semibold">{profileName || "Votre profil"}</span><span className="block text-caption text-textSecondary">Profil actif</span></span>
          </Link>
          <ThemeToggle />
          <QuotaBadge />
          <VersionBadge version={version} productName={productName} />
        </div>
      </aside>

      <nav aria-label="Navigation mobile" className="glass-panel glass-float fixed inset-x-2 bottom-[max(env(safe-area-inset-bottom),0.75rem)] z-40 grid grid-cols-6 !rounded-[22px] px-1 py-1.5 sm:inset-x-3 sm:px-1.5 lg:hidden">
        {items.map((item) => {
          const active = isActive(item.href);
          const Icon = item.icon;
          return (
            <Link key={item.href} href={item.href} aria-current={active ? "page" : undefined}
              className={cn("flex min-h-14 min-w-0 flex-col items-center justify-center gap-1 rounded-[16px] text-[11px] font-medium leading-4 tracking-tight transition-colors sm:px-0.5 sm:text-caption sm:tracking-normal", active ? "bg-accent/[.10] font-semibold text-accent" : "text-textSecondary hover:text-text")}>
              <Icon className="h-5 w-5" strokeWidth={1.65} />
              <span className="max-w-full truncate">{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </>
  );
}
