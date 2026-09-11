"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Users, Save, Trash2, ArrowRightLeft } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";

type Snapshot = { name: string; full_name?: string | null; saved_at?: string };

export function ProfileSwitcher({ currentName }: { currentName: string | null }) {
  const router = useRouter();
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [saveName, setSaveName] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = async () => {
    const res = await fetch("/api/profile/snapshots");
    if (res.ok) {
      const data = await res.json();
      setSnapshots(data.snapshots ?? []);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  async function act(action: "save" | "load" | "delete", name: string) {
    setBusy(`${action}:${name}`);
    setMessage(null);
    try {
      const res = await fetch("/api/profile/snapshots", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, name }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage(data.error ?? "Erreur");
        return;
      }
      if (action === "save") setMessage(`Profil sauvegardé sous « ${name} ».`);
      if (action === "load") {
        setMessage(`Profil « ${name} » chargé — ${data.rescored} offres re-scorées.`);
        router.refresh();
      }
      if (action === "delete") setMessage(`« ${name} » supprimé.`);
      setSaveName("");
      await refresh();
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card>
      <div className="flex items-center gap-2 mb-1">
        <Users className="h-4 w-4 text-textSecondary" />
        <h2 className="text-h3">Profils enregistrés</h2>
      </div>
      <p className="text-small text-textSecondary mb-4">
        Sauvegardez le profil actuel puis basculez d'un profil à l'autre en un clic — le score
        de toutes les offres est recalculé instantanément (aucune ré-extraction de CV).
      </p>

      {snapshots.length > 0 && (
        <div className="space-y-2 mb-4">
          {snapshots.map((s) => (
            <div
              key={s.name}
              className="flex items-center justify-between gap-3 p-3 rounded-md bg-surface"
            >
              <div className="min-w-0">
                <p className="text-body font-medium truncate">{s.name}</p>
                <p className="text-caption text-textSecondary truncate">
                  {s.full_name ?? "—"}
                  {s.saved_at ? ` · sauvegardé le ${s.saved_at.slice(0, 10)}` : ""}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={busy !== null}
                  onClick={() => act("load", s.name)}
                >
                  {busy === `load:${s.name}` ? (
                    <Spinner size={14} />
                  ) : (
                    <ArrowRightLeft className="h-3.5 w-3.5" />
                  )}
                  Charger
                </Button>
                <button
                  aria-label={`Supprimer ${s.name}`}
                  disabled={busy !== null}
                  onClick={() => act("delete", s.name)}
                  className="text-textSecondary hover:text-danger p-1.5"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-2">
        <Input
          value={saveName}
          onChange={(e) => setSaveName(e.target.value)}
          placeholder={
            currentName
              ? `Nom du snapshot (ex. « ${currentName} »)`
              : "Nom du snapshot"
          }
          onKeyDown={(e) =>
            e.key === "Enter" && saveName.trim() && act("save", saveName.trim())
          }
        />
        <Button
          variant="secondary"
          disabled={!saveName.trim() || busy !== null}
          onClick={() => act("save", saveName.trim())}
        >
          {busy?.startsWith("save:") ? <Spinner size={14} /> : <Save className="h-4 w-4" />}
          Sauvegarder le profil actuel
        </Button>
      </div>

      {message && <p className="text-small text-accent mt-3">{message}</p>}
    </Card>
  );
}
