"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Upload, AlertCircle, Check, ArrowLeft, Plus, Sparkles } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import type { ProfileFull, Experience, Education, Skill, Language } from "@/lib/cv/types";

const ACCEPT = ".pdf,.docx,.doc,.txt,.png,.jpg,.jpeg";

type Plan = {
  newExperiences: Experience[];
  enrichedExperiences: { title: string; company: string | null | undefined; newBullets: string[]; newSkills: string[] }[];
  newEducations: Education[];
  enrichedEducations: { school: string; degree: string | null | undefined; newBullets: string[] }[];
  newSkills: Skill[];
  newLanguages: Language[];
  duplicates: { skills: number; languages: number };
};

type Added = {
  newExperiences: number;
  enrichedExperiences: number;
  newEducations: number;
  enrichedEducations: number;
  newSkills: number;
  newLanguages: number;
};

export function AddCVFlow() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [filename, setFilename] = useState<string | null>(null);
  const [extractLoading, setExtractLoading] = useState(false);
  const [saveLoading, setSaveLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [incoming, setIncoming] = useState<ProfileFull | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [done, setDone] = useState<Added | null>(null);

  async function handleFile(file: File) {
    setError(null);
    setFilename(file.name);
    setExtractLoading(true);
    setIncoming(null);
    setPlan(null);
    setDone(null);
    try {
      const fd = new FormData();
      fd.append("cv", file);
      const res = await fetch("/api/profile/merge", { method: "POST", body: fd });
      // res.ok AVANT res.json() : un corps non-JSON ne doit pas masquer l'erreur.
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError(data?.error || `Erreur d'extraction (HTTP ${res.status}).`);
        return;
      }
      const data = await res.json().catch(() => null);
      if (!data?.incoming || !data?.plan) {
        setError("Réponse du serveur illisible — réessayez.");
        return;
      }
      setIncoming(data.incoming);
      setPlan(data.plan);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur réseau");
    } finally {
      setExtractLoading(false);
    }
  }

  async function confirm() {
    if (!incoming) return;
    setSaveLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/profile/merge", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirm: true, incoming }),
      });
      // res.ok AVANT res.json() — même motif que handleFile.
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError(data?.error || `Erreur de fusion (HTTP ${res.status}).`);
        return;
      }
      const data = await res.json().catch(() => null);
      if (!data?.added) {
        setError("Réponse du serveur illisible — réessayez.");
        return;
      }
      setDone(data.added);
      setIncoming(null);
      setPlan(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur réseau");
    } finally {
      setSaveLoading(false);
    }
  }

  // Done state
  if (done) {
    const total =
      done.newExperiences +
      done.enrichedExperiences +
      done.newEducations +
      done.enrichedEducations +
      done.newSkills +
      done.newLanguages;
    return (
      <Card className="text-center py-12">
        <div className="inline-flex h-12 w-12 rounded-full bg-success/15 text-success items-center justify-center mb-4">
          <Check className="h-6 w-6" />
        </div>
        <h2 className="text-h2 mb-2">Profil enrichi</h2>
        <div className="text-body text-textSecondary mb-6 space-y-1">
          {done.newExperiences > 0 && <p>+ {done.newExperiences} nouvelle{done.newExperiences > 1 ? "s" : ""} expérience{done.newExperiences > 1 ? "s" : ""}</p>}
          {done.enrichedExperiences > 0 && <p>{done.enrichedExperiences} expérience{done.enrichedExperiences > 1 ? "s" : ""} enrichie{done.enrichedExperiences > 1 ? "s" : ""} (missions ajoutées)</p>}
          {done.newEducations > 0 && <p>+ {done.newEducations} nouvelle{done.newEducations > 1 ? "s" : ""} formation{done.newEducations > 1 ? "s" : ""}</p>}
          {done.enrichedEducations > 0 && <p>{done.enrichedEducations} formation{done.enrichedEducations > 1 ? "s" : ""} enrichie{done.enrichedEducations > 1 ? "s" : ""}</p>}
          {done.newSkills > 0 && <p>+ {done.newSkills} nouvelle{done.newSkills > 1 ? "s" : ""} compétence{done.newSkills > 1 ? "s" : ""}</p>}
          {done.newLanguages > 0 && <p>+ {done.newLanguages} nouvelle{done.newLanguages > 1 ? "s" : ""} langue{done.newLanguages > 1 ? "s" : ""}</p>}
          {total === 0 && <p>Aucun ajout — ce CV ne contenait que des informations déjà présentes.</p>}
        </div>
        <div className="flex justify-center gap-2">
          <Button variant="secondary" onClick={() => { setDone(null); setFilename(null); }}>
            Ajouter un autre CV
          </Button>
          <Button onClick={() => router.push("/profile")}>Voir le profil</Button>
        </div>
      </Card>
    );
  }

  // Preview state
  if (incoming && plan) {
    const totalNew =
      plan.newExperiences.length +
      plan.newEducations.length +
      plan.newSkills.length +
      plan.newLanguages.length;
    const totalEnriched =
      plan.enrichedExperiences.length + plan.enrichedEducations.length;
    const totalChanges = totalNew + totalEnriched;

    return (
      <div className="space-y-4">
        <Card>
          <div className="flex items-center justify-between mb-5">
            <div>
              <h2 className="text-h3 mb-1">Aperçu de la fusion</h2>
              <p className="text-small text-textSecondary">{filename}</p>
            </div>
            <div className="flex flex-wrap gap-2 justify-end">
              {totalNew > 0 && <Badge variant="success">+{totalNew} nouveaux</Badge>}
              {totalEnriched > 0 && <Badge variant="info">{totalEnriched} enrichis</Badge>}
            </div>
          </div>

          {totalChanges === 0 ? (
            <p className="text-body text-textSecondary py-6 text-center">
              Aucune nouvelle information détectée.
            </p>
          ) : (
            <div className="space-y-6">
              {plan.enrichedExperiences.length > 0 && (
                <div>
                  <h3 className="text-body font-semibold mb-2 flex items-center gap-1.5">
                    <Sparkles className="h-4 w-4 text-accent" /> Expériences enrichies ({plan.enrichedExperiences.length})
                  </h3>
                  <ul className="space-y-3">
                    {plan.enrichedExperiences.map((e, i) => (
                      <li key={i} className="border-l-2 border-accent/40 pl-3">
                        <p className="text-small font-medium">
                          {e.title}{e.company ? ` — ${e.company}` : ""}
                        </p>
                        {e.newBullets.length > 0 && (
                          <>
                            <p className="text-caption text-textSecondary mt-1">
                              + {e.newBullets.length} nouvelle{e.newBullets.length > 1 ? "s" : ""} mission{e.newBullets.length > 1 ? "s" : ""}
                            </p>
                            <ul className="text-caption text-textSecondary list-disc pl-4 mt-1 space-y-0.5">
                              {e.newBullets.slice(0, 3).map((b, j) => (
                                <li key={j}>{b}</li>
                              ))}
                              {e.newBullets.length > 3 && <li>… +{e.newBullets.length - 3} autres</li>}
                            </ul>
                          </>
                        )}
                        {e.newSkills.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1.5">
                            {e.newSkills.map((s, j) => (
                              <Badge key={j} variant="info">+ {s}</Badge>
                            ))}
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {plan.newExperiences.length > 0 && (
                <DiffSection
                  title={`Nouvelles expériences (${plan.newExperiences.length})`}
                  variant="new"
                  items={plan.newExperiences.map((e) => ({
                    primary: e.title,
                    secondary: [e.company, e.start_date, e.end_date].filter(Boolean).join(" · "),
                  }))}
                />
              )}

              {plan.enrichedEducations.length > 0 && (
                <div>
                  <h3 className="text-body font-semibold mb-2 flex items-center gap-1.5">
                    <Sparkles className="h-4 w-4 text-accent" /> Formations enrichies ({plan.enrichedEducations.length})
                  </h3>
                  <ul className="space-y-2">
                    {plan.enrichedEducations.map((e, i) => (
                      <li key={i} className="border-l-2 border-accent/40 pl-3">
                        <p className="text-small font-medium">
                          {[e.degree, e.school].filter(Boolean).join(" — ")}
                        </p>
                        {e.newBullets.length > 0 && (
                          <p className="text-caption text-textSecondary mt-0.5">
                            + {e.newBullets.length} nouveau{e.newBullets.length > 1 ? "x" : ""} détail{e.newBullets.length > 1 ? "s" : ""}
                          </p>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {plan.newEducations.length > 0 && (
                <DiffSection
                  title={`Nouvelles formations (${plan.newEducations.length})`}
                  variant="new"
                  items={plan.newEducations.map((e) => ({
                    primary: [e.degree, e.field].filter(Boolean).join(" — ") || e.school,
                    secondary: [e.school, e.start_date, e.end_date].filter(Boolean).join(" · "),
                  }))}
                />
              )}

              {plan.newSkills.length > 0 && (
                <div>
                  <h3 className="text-body font-semibold mb-2">
                    Nouvelles compétences ({plan.newSkills.length})
                  </h3>
                  <div className="flex flex-wrap gap-1.5">
                    {plan.newSkills.map((s, i) => (
                      <Badge key={i} variant="success">{s.name}</Badge>
                    ))}
                  </div>
                  {plan.duplicates.skills > 0 && (
                    <p className="text-caption text-textSecondary mt-2">
                      {plan.duplicates.skills} compétence{plan.duplicates.skills > 1 ? "s" : ""} déjà présente{plan.duplicates.skills > 1 ? "s" : ""} (ignorée{plan.duplicates.skills > 1 ? "s" : ""}).
                    </p>
                  )}
                </div>
              )}

              {plan.newLanguages.length > 0 && (
                <div>
                  <h3 className="text-body font-semibold mb-2">
                    Nouvelles langues ({plan.newLanguages.length})
                  </h3>
                  <div className="flex flex-wrap gap-1.5">
                    {plan.newLanguages.map((l, i) => (
                      <Badge key={i} variant="default">
                        {l.name}{l.level ? ` (${l.level})` : ""}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {error && (
            <div className="mt-4 flex items-start gap-2 p-3 rounded-md bg-[rgba(255,59,48,0.08)] text-danger text-small">
              <AlertCircle className="h-4 w-4 mt-0.5" /> {error}
            </div>
          )}

          <div className="flex justify-end gap-2 mt-6">
            <Button variant="ghost" onClick={() => { setIncoming(null); setPlan(null); setFilename(null); }}>
              Annuler
            </Button>
            <Button onClick={confirm} disabled={saveLoading || totalChanges === 0}>
              {saveLoading && <Spinner size={16} className="text-white" />}
              {saveLoading ? "Fusion en cours…" : `Appliquer (${totalChanges} modification${totalChanges > 1 ? "s" : ""})`}
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  // Upload state
  return (
    <div className="space-y-4">
      <Button variant="ghost" onClick={() => router.push("/profile")}>
        <ArrowLeft className="h-4 w-4" /> Retour au profil
      </Button>

      <Card>
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            const file = e.dataTransfer.files[0];
            if (file) handleFile(file);
          }}
          onClick={() => !extractLoading && inputRef.current?.click()}
          className={cn(
            "border-2 border-dashed rounded-xl p-12 flex flex-col items-center justify-center gap-3 cursor-pointer transition-all",
            extractLoading
              ? "border-border bg-surface cursor-default"
              : dragOver
              ? "border-accent bg-accent/5"
              : "border-border bg-surface hover:bg-surfaceHover"
          )}
        >
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPT}
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
            }}
          />
          {extractLoading ? (
            <>
              <Spinner size={28} />
              <p className="text-body text-text mt-2">Lecture de votre CV…</p>
              <p className="text-small text-textSecondary">{filename}</p>
            </>
          ) : (
            <>
              <Upload className="h-8 w-8 text-textSecondary" />
              <p className="text-body text-text font-medium">Glissez un nouveau CV</p>
              <p className="text-small text-textSecondary text-center max-w-md">
                Les expériences/formations identiques (même entreprise, même école, dates qui se chevauchent) seront <strong>enrichies</strong> avec les nouvelles missions, sans créer de doublon.
              </p>
            </>
          )}
        </div>

        {error && (
          <div className="mt-4 flex items-start gap-2 p-3 rounded-md bg-[rgba(255,59,48,0.08)] text-danger text-small">
            <AlertCircle className="h-4 w-4 mt-0.5" /> {error}
          </div>
        )}
      </Card>
    </div>
  );
}

function DiffSection({
  title,
  items,
  variant = "new",
}: {
  title: string;
  items: { primary: string; secondary?: string }[];
  variant?: "new" | "enriched";
}) {
  return (
    <div>
      <h3 className="text-body font-semibold mb-2 flex items-center gap-1.5">
        {variant === "new" ? <Plus className="h-4 w-4 text-success" /> : <Sparkles className="h-4 w-4 text-accent" />}
        {title}
      </h3>
      <ul className="space-y-1.5">
        {items.map((it, i) => (
          <li
            key={i}
            className={cn(
              "border-l-2 pl-3",
              variant === "new" ? "border-success/40" : "border-accent/40"
            )}
          >
            <p className="text-small font-medium">{it.primary}</p>
            {it.secondary && <p className="text-caption text-textSecondary">{it.secondary}</p>}
          </li>
        ))}
      </ul>
    </div>
  );
}
