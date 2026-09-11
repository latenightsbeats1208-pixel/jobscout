"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, ChevronDown, AlertTriangle } from "lucide-react";
import { Input, Textarea } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { ProfileFull } from "@/lib/cv/types";

type Section = "identity" | "experiences" | "educations" | "skills" | "languages";

export function VerifyForm() {
  const router = useRouter();
  const [profile, setProfile] = useState<ProfileFull | null>(null);
  const [open, setOpen] = useState<Record<Section, boolean>>({
    identity: true,
    experiences: true,
    educations: false,
    skills: false,
    languages: false,
  });

  useEffect(() => {
    const raw = sessionStorage.getItem("jobscout:extracted-profile");
    if (!raw) {
      router.replace("/onboarding/upload");
      return;
    }
    setProfile(JSON.parse(raw));
  }, [router]);

  if (!profile) return null;

  const update = (patch: Partial<ProfileFull>) => setProfile({ ...profile, ...patch });
  const toggle = (s: Section) => setOpen((o) => ({ ...o, [s]: !o[s] }));

  function next() {
    sessionStorage.setItem("jobscout:extracted-profile", JSON.stringify(profile));
    router.push("/onboarding/preferences");
  }

  return (
    <div className="space-y-4">
      {profile.extraction_confidence < 60 && (
        <div className="flex items-start gap-3 p-4 rounded-md bg-[rgba(255,159,10,0.08)] text-[#c97400]">
          <AlertTriangle className="h-5 w-5 mt-0.5" />
          <div className="text-small">
            <strong className="font-semibold">Extraction partielle</strong> — confiance{" "}
            {profile.extraction_confidence}%. Vérifiez attentivement les champs ci-dessous.
          </div>
        </div>
      )}

      {/* Identity */}
      <SectionCard
        title="Identité"
        open={open.identity}
        onToggle={() => toggle("identity")}
        badge={profile.full_name && profile.email ? "ok" : "warn"}
      >
        <div className="grid grid-cols-2 gap-3">
          <Field label="Nom complet">
            <Input
              value={profile.full_name ?? ""}
              onChange={(e) => update({ full_name: e.target.value })}
            />
          </Field>
          <Field label="Email">
            <Input
              type="email"
              value={profile.email ?? ""}
              onChange={(e) => update({ email: e.target.value })}
            />
          </Field>
          <Field label="Téléphone">
            <Input value={profile.phone ?? ""} onChange={(e) => update({ phone: e.target.value })} />
          </Field>
          <Field label="Localisation">
            <Input
              value={profile.location ?? ""}
              onChange={(e) => update({ location: e.target.value })}
            />
          </Field>
          <Field label="LinkedIn">
            <Input
              value={profile.linkedin_url ?? ""}
              onChange={(e) => update({ linkedin_url: e.target.value })}
            />
          </Field>
          <Field label="Portfolio">
            <Input
              value={profile.portfolio_url ?? ""}
              onChange={(e) => update({ portfolio_url: e.target.value })}
            />
          </Field>
        </div>
        <div className="mt-3">
          <Field label="Résumé">
            <Textarea
              value={profile.summary ?? ""}
              onChange={(e) => update({ summary: e.target.value })}
              rows={3}
            />
          </Field>
        </div>
      </SectionCard>

      {/* Experiences */}
      <SectionCard
        title={`Expériences (${profile.experiences.length})`}
        open={open.experiences}
        onToggle={() => toggle("experiences")}
        badge={profile.experiences.length >= 1 ? "ok" : "warn"}
      >
        <div className="space-y-4">
          {profile.experiences.map((e, i) => (
            <div key={i} className="border border-border rounded-md p-4 space-y-3">
              <div className="flex items-start gap-2">
                <div className="flex-1 grid grid-cols-2 gap-3">
                  <Field label="Poste">
                    <Input
                      value={e.title}
                      onChange={(ev) => {
                        const exp = [...profile.experiences];
                        exp[i] = { ...e, title: ev.target.value };
                        update({ experiences: exp });
                      }}
                    />
                  </Field>
                  <Field label="Entreprise">
                    <Input
                      value={e.company ?? ""}
                      onChange={(ev) => {
                        const exp = [...profile.experiences];
                        exp[i] = { ...e, company: ev.target.value };
                        update({ experiences: exp });
                      }}
                    />
                  </Field>
                  <Field label="Début (YYYY-MM)">
                    <Input
                      value={e.start_date ?? ""}
                      placeholder="2023-01"
                      onChange={(ev) => {
                        const exp = [...profile.experiences];
                        exp[i] = { ...e, start_date: ev.target.value };
                        update({ experiences: exp });
                      }}
                    />
                  </Field>
                  <Field label="Fin (YYYY-MM ou 'present')">
                    <Input
                      value={e.end_date ?? ""}
                      placeholder="present"
                      onChange={(ev) => {
                        const exp = [...profile.experiences];
                        exp[i] = { ...e, end_date: ev.target.value };
                        update({ experiences: exp });
                      }}
                    />
                  </Field>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => {
                    const exp = profile.experiences.filter((_, j) => j !== i);
                    update({ experiences: exp });
                  }}
                  aria-label="Supprimer"
                >
                  <Trash2 className="h-4 w-4 text-textSecondary" />
                </Button>
              </div>
              <Field label="Description">
                <Textarea
                  value={e.description ?? ""}
                  rows={2}
                  onChange={(ev) => {
                    const exp = [...profile.experiences];
                    exp[i] = { ...e, description: ev.target.value };
                    update({ experiences: exp });
                  }}
                />
              </Field>
              {e.bullet_points.length > 0 && (
                <Field label="Réalisations">
                  <ul className="text-small text-textSecondary list-disc pl-5 space-y-1">
                    {e.bullet_points.map((b, k) => (
                      <li key={k}>{b}</li>
                    ))}
                  </ul>
                </Field>
              )}
              {e.skills_used.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {e.skills_used.map((s, k) => (
                    <Badge key={k} variant="info">
                      {s}
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          ))}
          <Button
            variant="secondary"
            size="sm"
            onClick={() =>
              update({
                experiences: [
                  ...profile.experiences,
                  {
                    title: "",
                    company: "",
                    location: null,
                    start_date: null,
                    end_date: null,
                    description: null,
                    bullet_points: [],
                    skills_used: [],
                  },
                ],
              })
            }
          >
            <Plus className="h-4 w-4" /> Ajouter une expérience
          </Button>
        </div>
      </SectionCard>

      {/* Educations */}
      <SectionCard
        title={`Formations (${profile.educations.length})`}
        open={open.educations}
        onToggle={() => toggle("educations")}
        badge={profile.educations.length >= 1 ? "ok" : "warn"}
      >
        <div className="space-y-4">
          {profile.educations.map((e, i) => (
            <div key={i} className="border border-border rounded-md p-4">
              <div className="flex items-start gap-2">
                <div className="flex-1 grid grid-cols-2 gap-3">
                  <Field label="École">
                    <Input
                      value={e.school}
                      onChange={(ev) => {
                        const ed = [...profile.educations];
                        ed[i] = { ...e, school: ev.target.value };
                        update({ educations: ed });
                      }}
                    />
                  </Field>
                  <Field label="Diplôme">
                    <Input
                      value={e.degree ?? ""}
                      onChange={(ev) => {
                        const ed = [...profile.educations];
                        ed[i] = { ...e, degree: ev.target.value };
                        update({ educations: ed });
                      }}
                    />
                  </Field>
                  <Field label="Spécialité">
                    <Input
                      value={e.field ?? ""}
                      onChange={(ev) => {
                        const ed = [...profile.educations];
                        ed[i] = { ...e, field: ev.target.value };
                        update({ educations: ed });
                      }}
                    />
                  </Field>
                  <div className="grid grid-cols-2 gap-2">
                    <Field label="Début">
                      <Input
                        value={e.start_date ?? ""}
                        onChange={(ev) => {
                          const ed = [...profile.educations];
                          ed[i] = { ...e, start_date: ev.target.value };
                          update({ educations: ed });
                        }}
                      />
                    </Field>
                    <Field label="Fin">
                      <Input
                        value={e.end_date ?? ""}
                        onChange={(ev) => {
                          const ed = [...profile.educations];
                          ed[i] = { ...e, end_date: ev.target.value };
                          update({ educations: ed });
                        }}
                      />
                    </Field>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => update({ educations: profile.educations.filter((_, j) => j !== i) })}
                >
                  <Trash2 className="h-4 w-4 text-textSecondary" />
                </Button>
              </div>
            </div>
          ))}
          <Button
            variant="secondary"
            size="sm"
            onClick={() =>
              update({
                educations: [
                  ...profile.educations,
                  {
                    school: "",
                    degree: null,
                    field: null,
                    location: null,
                    start_date: null,
                    end_date: null,
                    description: null,
                  },
                ],
              })
            }
          >
            <Plus className="h-4 w-4" /> Ajouter une formation
          </Button>
        </div>
      </SectionCard>

      {/* Skills */}
      <SectionCard
        title={`Compétences (${profile.skills.length})`}
        open={open.skills}
        onToggle={() => toggle("skills")}
        badge={profile.skills.length >= 3 ? "ok" : "warn"}
      >
        <div className="flex flex-wrap gap-2 mb-3">
          {profile.skills.map((s, i) => (
            <Badge
              key={i}
              variant={s.evidence_experience_ids.length > 0 ? "success" : "default"}
              className="pl-3 pr-1.5 py-1 gap-1.5 inline-flex items-center cursor-default"
              title={
                s.evidence_experience_ids.length > 0
                  ? "Compétence ancrée sur une expérience"
                  : "Sans preuve d'expérience"
              }
            >
              {s.name}
              <button
                onClick={() => update({ skills: profile.skills.filter((_, j) => j !== i) })}
                className="ml-1 opacity-60 hover:opacity-100"
              >
                ×
              </button>
            </Badge>
          ))}
        </div>
        <SkillAdder
          onAdd={(name) =>
            update({
              skills: [
                ...profile.skills,
                { name, category: null, level: null, evidence_experience_ids: [] },
              ],
            })
          }
        />
      </SectionCard>

      {/* Languages */}
      <SectionCard
        title={`Langues (${profile.languages.length})`}
        open={open.languages}
        onToggle={() => toggle("languages")}
        badge={profile.languages.length >= 1 ? "ok" : "warn"}
      >
        <div className="space-y-2">
          {profile.languages.map((l, i) => (
            <div key={i} className="flex gap-2">
              <Input
                value={l.name}
                placeholder="Langue"
                onChange={(ev) => {
                  const lang = [...profile.languages];
                  lang[i] = { ...l, name: ev.target.value };
                  update({ languages: lang });
                }}
              />
              <Input
                value={l.level ?? ""}
                placeholder="Niveau (B2, courant…)"
                onChange={(ev) => {
                  const lang = [...profile.languages];
                  lang[i] = { ...l, level: ev.target.value };
                  update({ languages: lang });
                }}
              />
              <Button
                variant="ghost"
                size="icon"
                onClick={() => update({ languages: profile.languages.filter((_, j) => j !== i) })}
              >
                <Trash2 className="h-4 w-4 text-textSecondary" />
              </Button>
            </div>
          ))}
          <Button
            variant="secondary"
            size="sm"
            onClick={() => update({ languages: [...profile.languages, { name: "", level: null }] })}
          >
            <Plus className="h-4 w-4" /> Ajouter une langue
          </Button>
        </div>
      </SectionCard>

      <div className="flex justify-end pt-4">
        <Button onClick={next} size="lg">
          Continuer
        </Button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-caption font-medium text-textSecondary uppercase tracking-wide">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

function SectionCard({
  title,
  open,
  onToggle,
  badge,
  children,
}: {
  title: string;
  open: boolean;
  onToggle: () => void;
  badge: "ok" | "warn";
  children: React.ReactNode;
}) {
  return (
    <Card className="p-0 overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between p-5 hover:bg-surface transition-colors"
      >
        <div className="flex items-center gap-3">
          <span
            className={cn(
              "h-2 w-2 rounded-full",
              badge === "ok" ? "bg-success" : "bg-warning"
            )}
          />
          <h2 className="text-h3 font-semibold">{title}</h2>
        </div>
        <ChevronDown
          className={cn("h-5 w-5 text-textSecondary transition-transform", open && "rotate-180")}
        />
      </button>
      {open && <div className="px-5 pb-5">{children}</div>}
    </Card>
  );
}

function SkillAdder({ onAdd }: { onAdd: (name: string) => void }) {
  const [value, setValue] = useState("");
  return (
    <div className="flex gap-2">
      <Input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Ajouter une compétence"
        onKeyDown={(e) => {
          if (e.key === "Enter" && value.trim()) {
            onAdd(value.trim());
            setValue("");
          }
        }}
      />
      <Button
        variant="secondary"
        onClick={() => {
          if (value.trim()) {
            onAdd(value.trim());
            setValue("");
          }
        }}
      >
        Ajouter
      </Button>
    </div>
  );
}
