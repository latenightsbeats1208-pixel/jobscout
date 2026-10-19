"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { History } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { fromSqliteUtc } from "@/lib/utils";

/**
 * Offres d'une recherche précédente : notées pour le profil actuel, elles n'ont
 * pas été cherchées pour lui. La liste propose de les masquer — rien n'est
 * effacé, et le même bouton les rend.
 */
export function PreviousSearchNotice({ count, since, hidden }: { count: number; since: string; hidden: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const when = new Date(fromSqliteUtc(since)).toLocaleDateString("fr-FR", { day: "numeric", month: "long" });
  const n = count.toLocaleString("fr-FR");
  const many = count > 1;

  async function toggle() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/offres/current-search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled: !hidden }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Erreur");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur réseau");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div role="status" className="glass-panel -mt-4 mb-6 flex max-w-[75ch] flex-col gap-3 p-4 sm:flex-row sm:items-center">
      <History className="hidden h-5 w-5 shrink-0 text-textSecondary sm:block" />
      <p className="min-w-0 flex-1 text-small text-textSecondary">
        {hidden ? (
          <>
            <span className="font-semibold text-text">{n} offre{many ? "s" : ""} d&apos;une recherche précédente {many ? "sont masquées" : "est masquée"}.</span>{" "}
            La liste ne montre que la recherche lancée le {when}.
          </>
        ) : (
          <>
            <span className="font-semibold text-text">{n} offre{many ? "s viennent" : " vient"} d&apos;une recherche précédente.</span>{" "}
            {many ? "Elles sont notées" : "Elle est notée"} pour votre profil actuel, mais {many ? "n'ont" : "n'a"} pas été cherchée{many ? "s" : ""} pour lui (recherche en cours depuis le {when}).
          </>
        )}
        {error && <span role="alert" className="mt-1 block text-danger">{error}</span>}
      </p>
      <Button variant="secondary" onClick={toggle} disabled={busy} className="shrink-0 self-start sm:self-center">
        {busy && <Spinner className="h-4 w-4" />}
        {hidden ? "Les afficher" : "Les masquer"}
      </Button>
    </div>
  );
}
