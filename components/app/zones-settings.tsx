"use client";
import { useEffect, useState } from "react";
import { MapPin, Check } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";

type ZoneEntry = { id: string; label: string; places: string[] };

/** Zones de recherche : lieux visés par le scan et filtre « Mes zones » de la page Offres. */
export function ZonesSettings() {
  const [catalogue, setCatalogue] = useState<ZoneEntry[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/settings/zones")
      .then((r) => r.json())
      .then((d) => {
        setCatalogue(d.catalogue ?? []);
        setSelected(new Set(d.zones ?? []));
      })
      .catch(() => setError("Zones indisponibles."));
  }, []);

  async function toggle(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
    setSaved(false);
    setError(null);
    const res = await fetch("/api/settings/zones", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ zones: [...next] }),
    });
    if (res.ok) setSaved(true);
    else setError("Enregistrement impossible.");
  }

  return (
    <Card>
      <div className="mb-3 flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-md bg-surface text-textSecondary"><MapPin className="h-5 w-5" /></div>
        <h2 className="text-h3">Zones de recherche</h2>
      </div>
      <p className="mb-4 text-small text-textSecondary">
        Le scan cherche dans ces zones plutôt que dans tout le pays (France Travail par département, LinkedIn et Talent.com par ville),
        et la page Offres s'ouvre filtrée sur « Mes zones ». Aucune zone : recherche sur les pays ciblés, comme avant.
      </p>
      <div className="flex flex-wrap gap-2">
        {catalogue.map((z) => (
          <Chip key={z.id} active={selected.has(z.id)} onClick={() => toggle(z.id)}>
            {z.label}
          </Chip>
        ))}
      </div>
      {catalogue.filter((z) => selected.has(z.id)).map((z) => (
        <p key={z.id} className="mt-2 text-caption text-textSecondary">{z.label} : {z.places.join(", ")}</p>
      ))}
      {saved && <p role="status" className="mt-3 inline-flex items-center gap-1.5 text-small text-success"><Check className="h-4 w-4" /> Enregistré</p>}
      {error && <p role="alert" className="mt-3 text-small text-danger">{error}</p>}
    </Card>
  );
}
