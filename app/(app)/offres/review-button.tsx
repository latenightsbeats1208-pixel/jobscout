"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

const LIMIT = 30;

/**
 * Relecture par l'IA des 30 meilleures offres : vérifie que le profil couvre
 * leurs exigences indispensables. Payant (un appel par lot de 8 offres) ; les
 * offres déjà relues pour ce profil ne sont pas facturées une seconde fois.
 */
export function ReviewButton() {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  async function run() {
    setRunning(true);
    setMessage(null);
    try {
      const res = await fetch("/api/offres/review", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ limit: LIMIT }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage({ tone: "error", text: data.error || "La relecture a échoué." });
        return;
      }
      const parts = [`${data.reviewed} offre${data.reviewed > 1 ? "s" : ""} relue${data.reviewed > 1 ? "s" : ""}`];
      if (data.cached) parts.push(`${data.cached} déjà relue${data.cached > 1 ? "s" : ""}`);
      if (data.unreadable) parts.push(`${data.unreadable} sans réponse exploitable`);
      setMessage({ tone: "ok", text: `${parts.join(", ")}. Notes mises à jour.` });
      router.refresh();
    } catch {
      setMessage({ tone: "error", text: "Connexion interrompue pendant la relecture." });
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="flex flex-col items-start gap-1 sm:items-end">
      <Button variant="secondary" onClick={run} disabled={running} title={`Vérifie avec votre IA que votre profil couvre les exigences des ${LIMIT} meilleures offres`}>
        {running ? <Spinner className="h-4 w-4" /> : <Sparkles className="h-4 w-4" />}
        {running ? "Relecture en cours…" : "Relire avec l'IA"}
      </Button>
      {message && (
        <p role={message.tone === "error" ? "alert" : "status"} className={message.tone === "error" ? "text-small text-danger" : "text-small text-textSecondary"}>
          {message.text}
        </p>
      )}
    </div>
  );
}
