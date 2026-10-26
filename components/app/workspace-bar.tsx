"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight } from "lucide-react";

const labels: Record<string, string> = {
  dashboard: "Vue d’ensemble",
  offres: "Offres",
  candidatures: "Candidatures",
  documents: "Documents",
  "cv-template": "Modèle CV",
  profile: "Profil",
};

export function WorkspaceBar() {
  const segments = usePathname().split("/").filter(Boolean);
  const section = segments[0];
  return (
    <div className="mb-9 hidden min-h-10 items-center lg:flex">
      <nav aria-label="Fil d’Ariane" className="flex items-center gap-2.5 text-small">
        <Link href="/dashboard" className="text-textSecondary transition-colors hover:text-accent">Mon espace</Link>
        <ChevronRight className="h-3 w-3 text-textSecondary" aria-hidden="true" />
        {segments.length > 1 ? <><Link href={`/${section}`} className="text-textSecondary hover:text-accent">{labels[section]}</Link><ChevronRight className="h-3 w-3 text-textSecondary" aria-hidden="true" /><span className="font-medium">{section === "offres" ? "Détail de l’offre" : "Ajouter un CV"}</span></> : <span className="font-medium">{labels[section] || "Mon espace"}</span>}
      </nav>
    </div>
  );
}
