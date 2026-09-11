"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { Spinner } from "@/components/ui/spinner";
import type { ProfileFull } from "@/lib/cv/types";
import { COUNTRY_GROUPS, FRANCOPHONIE } from "@/lib/countries";
import { SOURCES_META, DEFAULT_SOURCE_IDS } from "@/lib/sources-meta";
import { EngineNotice } from "@/components/app/engine-notice";
const SOURCES = SOURCES_META;

export function PreferencesForm() {
  const router = useRouter();
  const [profile, setProfile] = useState<ProfileFull | null>(null);
  const [sectorInput, setSectorInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const raw = sessionStorage.getItem("jobscout:extracted-profile");
    if (!raw) {
      router.replace("/onboarding/upload");
      return;
    }
    const p: ProfileFull = JSON.parse(raw);
    if (!p.sources_enabled?.length) p.sources_enabled = [...DEFAULT_SOURCE_IDS];
    if (!p.preferred_contracts?.length) p.preferred_contracts = ["cdi", "cdd"];
    setProfile(p);
  }, [router]);

  if (!profile) return null;

  const update = (patch: Partial<ProfileFull>) => setProfile({ ...profile, ...patch });

  const toggleCountry = (c: string) => {
    const has = profile.target_countries.includes(c);
    update({
      target_countries: has
        ? profile.target_countries.filter((x) => x !== c)
        : [...profile.target_countries, c],
    });
  };
  const toggleSource = (id: string) => {
    const has = profile.sources_enabled.includes(id);
    update({
      sources_enabled: has
        ? profile.sources_enabled.filter((x) => x !== id)
        : [...profile.sources_enabled, id],
    });
  };

  const addSector = () => {
    const v = sectorInput.trim();
    if (!v) return;
    if (profile.sectors.includes(v)) return;
    update({ sectors: [...profile.sectors, v] });
    setSectorInput("");
  };

  async function save() {
    if (!profile) return;
    if (profile.sectors.length === 0) {
      setError("Ajoutez au moins un secteur cible.");
      return;
    }
    if (profile.target_countries.length === 0) {
      setError("Sélectionnez au moins un pays.");
      return;
    }
    if (profile.sources_enabled.length === 0) {
      setError("Sélectionnez au moins une plateforme.");
      return;
    }
    if (profile.preferred_contracts.length === 0) {
      setError("Sélectionnez au moins un type de contrat.");
      return;
    }
    setSaving(true);
    setError(null);
    const res = await fetch("/api/profile", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(profile),
    });
    if (!res.ok) {
      const data = await res.json();
      setError(data.error || "Erreur de sauvegarde");
      setSaving(false);
      return;
    }
    sessionStorage.removeItem("jobscout:extracted-profile");
    router.push("/dashboard");
  }

  return (
    <div className="space-y-5">
      <Card>
        <h2 className="text-h3 mb-1">Secteurs cibles</h2>
        <p className="text-small text-textSecondary mb-4">
          Mots-clés des secteurs / branches qui vous intéressent.
        </p>
        <div className="flex flex-wrap gap-2 mb-3">
          {profile.sectors.map((s) => (
            <Chip
              key={s}
              active
              onRemove={() => update({ sectors: profile.sectors.filter((x) => x !== s) })}
            >
              {s}
            </Chip>
          ))}
        </div>
        <div className="flex gap-2">
          <Input
            value={sectorInput}
            onChange={(e) => setSectorInput(e.target.value)}
            placeholder="Marketing digital, Data Science…"
            onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addSector())}
          />
          <Button variant="secondary" onClick={addSector}>
            <Plus className="h-4 w-4" /> Ajouter
          </Button>
        </div>
      </Card>

      <Card>
        <h2 className="text-h3 mb-1">Contrats recherchés</h2>
        <p className="text-small text-textSecondary mb-4">
          Les offres correspondantes sont favorisées dans le score ; les autres types restent visibles mais dépriorisés.
        </p>
        <div className="flex flex-wrap gap-2">
          {(
            [
              ["cdi", "CDI"],
              ["cdd", "CDD"],
              ["vie", "V.I.E"],
              ["stage", "Stage"],
              ["alternance", "Alternance"],
            ] as const
          ).map(([id, label]) => (
            <Chip
              key={id}
              active={profile.preferred_contracts.includes(id)}
              onClick={() => {
                const has = profile.preferred_contracts.includes(id);
                update({
                  preferred_contracts: has
                    ? profile.preferred_contracts.filter((x) => x !== id)
                    : [...profile.preferred_contracts, id],
                });
              }}
            >
              {label}
            </Chip>
          ))}
        </div>
      </Card>

      <Card>
        <h2 className="text-h3 mb-1">Pays cibles</h2>
        <p className="text-small text-textSecondary mb-3">
          Sélectionnez les pays où vous souhaitez postuler.
        </p>
        <div className="flex flex-wrap gap-2 mb-4">
          <Chip
            active={FRANCOPHONIE.every((c) => profile.target_countries.includes(c))}
            onClick={() =>
              update({
                target_countries: Array.from(
                  new Set([...profile.target_countries, ...FRANCOPHONIE])
                ),
              })
            }
          >
            + Francophonie ({FRANCOPHONIE.length} pays)
          </Chip>
          {profile.target_countries.length > 0 && (
            <button
              onClick={() => update({ target_countries: [] })}
              className="text-small text-accent hover:underline"
            >
              Tout effacer ({profile.target_countries.length})
            </button>
          )}
        </div>
        <div className="space-y-4 max-h-[420px] overflow-y-auto pr-2">
          {COUNTRY_GROUPS.map((group) => (
            <div key={group.region}>
              <p className="text-caption uppercase tracking-wide text-textSecondary mb-2">
                {group.region}
              </p>
              <div className="flex flex-wrap gap-2">
                {group.countries.map((c) => (
                  <Chip
                    key={c}
                    active={profile.target_countries.includes(c)}
                    onClick={() => toggleCountry(c)}
                  >
                    {c}
                  </Chip>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <h2 className="text-h3 mb-1">Sources de scan</h2>
        <p className="text-small text-textSecondary mb-4">
          Plateformes scannées à chaque recherche. 7 sources disponibles — les sources
          directes sont activées par défaut.
        </p>
        <EngineNotice
          active={profile.sources_enabled.includes("linkedin")}
          className="mb-4"
        />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {SOURCES.map((s) => {
            const active = profile.sources_enabled.includes(s.id);
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => toggleSource(s.id)}
                className={`flex items-center justify-between gap-3 p-3 rounded-md border text-left transition-colors ${
                  active
                    ? "border-accent bg-accent/5"
                    : "border-border hover:bg-surface"
                }`}
              >
                <div className="min-w-0">
                  <p className="text-body font-medium truncate">{s.label}</p>
                  <p className="text-caption text-textSecondary truncate">{s.sublabel}</p>
                </div>
                <span
                  className={`shrink-0 h-4 w-4 rounded-full border flex items-center justify-center ${
                    active ? "border-accent bg-accent" : "border-border"
                  }`}
                >
                  {active && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
                </span>
              </button>
            );
          })}
        </div>
      </Card>

      {error && <p className="text-small text-danger">{error}</p>}

      <div className="flex justify-between pt-4">
        <Button variant="ghost" onClick={() => router.back()}>
          Retour
        </Button>
        <Button onClick={save} size="lg" disabled={saving}>
          {saving && <Spinner size={16} className="text-white" />}
          {saving ? "Enregistrement…" : "Enregistrer mon profil"}
        </Button>
      </div>
    </div>
  );
}
