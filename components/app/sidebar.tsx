"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, Briefcase, FileText, FolderOpen, User } from "lucide-react";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "./theme-toggle";
import { VersionBadge } from "./version-badge";
import { QuotaBadge } from "./quota-badge";

const items = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/offres", label: "Offres", icon: Briefcase },
  { href: "/candidatures", label: "Candidatures", icon: FileText },
  { href: "/documents", label: "Documents", icon: FolderOpen },
  { href: "/profile", label: "Profil", icon: User },
];

export function Sidebar({
  version,
  productName = "JobScout",
}: {
  version: string;
  /** « JobScout Test » dans l'installeur de test — voir lib/update/check.ts. */
  productName?: string;
}) {
  const pathname = usePathname();
  return (
    <aside className="fixed left-0 top-0 h-screen w-[240px] flex flex-col py-8 px-4 border-r border-border bg-bg">
      <div className="px-3 mb-10">
        <h1 className="text-h3 font-semibold tracking-tight">Job Scout</h1>
        <p className="text-caption text-textSecondary mt-0.5">Recherche d'emploi augmentée</p>
      </div>
      <nav className="flex flex-col gap-1">
        {items.map((item) => {
          const active = pathname === item.href || pathname?.startsWith(item.href + "/");
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 h-10 px-3 rounded-md text-body transition-colors",
                active
                  ? "bg-surface text-text font-medium"
                  : "text-textSecondary hover:bg-surface hover:text-text"
              )}
            >
              <Icon className="h-[18px] w-[18px]" />
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="mt-auto pt-4 border-t border-border">
        <ThemeToggle />
        <QuotaBadge />
        <VersionBadge version={version} productName={productName} />
      </div>
    </aside>
  );
}
