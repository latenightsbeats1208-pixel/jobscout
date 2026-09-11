"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Plus,
  Trash2,
  Save,
  X,
  Briefcase,
  GraduationCap,
  Wrench,
  Languages,
  Globe,
  User,
  ChevronDown,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Input, Textarea } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Chip } from "@/components/ui/chip";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { COUNTRY_GROUPS } from "@/lib/countries";
import { SOURCES_META } from "@/lib/sources-meta";
import { EngineNotice } from "@/components/app/engine-notice";
import type { ProfileFull, Experience, Education, Skill, Language } from "@/lib/cv/types";

const SOURCES = SOURCES_META;

export function ProfileEditor({ initial }: { initial: ProfileFull }) {
  const router = useRouter();
  const [profile, setProfile] = useState<ProfileFull>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedTick, setSavedTick] = useState(false);

  const dirty = useMemo(
    () => JSON.stringify(profile) !== JSON.stringify(initial),
    [profile, initial]
  );

  useEffect(() => {
    function onBeforeUnload(e: BeforeUnloadEvent) {
      if (!dirty) return;
      e.preventDefault();
      e.returnValue = "";
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  const update = (patch: Partial<ProfileFull>) => setProfile((p) => ({ ...p, ...patch }));

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/profile", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(profile),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Erreur d'enregistrement");
        return;
      }
      setSavedTick(true);
      setTimeout(() => setSavedTick(false), 1800);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur réseau");
    } finally {
      setSaving(false);
    }
  }

  function cancel() {
    setProfile(initial);
    setError(null);
  }

  return (
    <>
      {/* Sticky save bar */}
      {(dirty || savedTick) && (
        <div className="sticky top-0 z-30 -mx-12 mb-5 px-12 py-3 bg-bg/85 backdrop-blur border-b border-border animate-fadeIn flex items-center gap-3">
          <span className="text-small">
            {savedTick ? (
              <span className="text-success">Modifications enregistrées ✓</span>
            ) : (
              <span className="text-textSecondary">
                Modifications non enregistrées
              </span>
            )}
          </span>
          <div className="flex-1" />
          {dirty && (
            <>
              <Button variant="ghost" onClick={cancel} disabled={saving}>
                <X className="h-4 w-4" /> Annuler
              </Button>
              <Button onClick={save} disabled={saving}>
                {saving ? <Spinner size={14} className="text-white" /> : <Save className="h-4 w-4" />}
                Enregistrer
              </Button>
            </>
          )}
        </div>
      )}
      {error && (
        <div className="mb-5 p-3 rounded-md bg-[rgba(255,59,48,0.08)] text-danger text-small">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <IdentityCard profile={profile} update={update} />
        <SearchCard profile={profile} update={update} />

        <ExperiencesCard profile={profile} update={update} />
        <EducationsCard profile={profile} update={update} />
        <SkillsCard profile={profile} update={update} />
        <LanguagesCard profile={profile} update={update} />
      </div>
    </>
  );
}

// ============================================================
// Identity
// ============================================================

function IdentityCard({
  profile,
  update,
}: {
  profile: ProfileFull;
  update: (p: Partial<ProfileFull>) => void;
}) {
  return (
    <Card>
      <SectionHead icon={<User className="h-4 w-4" />} title="Identité" />
      <div className="grid grid-cols-2 gap-3">
        <Field label="Nom complet">
          <Input
            value={profile.full_name ?? ""}
            onChange={(e) => update({ full_name: e.target.value })}
          />
        </Field>
        <Field label="Email">
          <Input
            value={profile.email ?? ""}
            onChange={(e) => update({ email: e.target.value })}
          />
        </Field>
        <Field label="Téléphone">
          <Input
            value={profile.phone ?? ""}
            onChange={(e) => update({ phone: e.target.value })}
          />
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
    </Card>
  );
}

// ============================================================
// Recherche (sectors / countries / sources)
// ============================================================

function SearchCard({
  profile,
  update,
}: {
  profile: ProfileFull;
  update: (p: Partial<ProfileFull>) => void;
}) {
  const [sector, setSector] = useState("");
  const [showCountries, setShowCountries] = useState(false);

  const addSector = () => {
    const v = sector.trim();
    if (!v || profile.sectors.includes(v)) {
      setSector("");
      return;
    }
    update({ sectors: [...profile.sectors, v] });
    setSector("");
  };
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

  return (
    <Card>
      <SectionHead icon={<Globe className="h-4 w-4" />} title="Recherche" />

      <p className="text-caption uppercase text-textSecondary mb-2">Secteurs</p>
      <div className="flex flex-wrap gap-1.5 mb-2">
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
      <div className="flex gap-2 mb-4">
        <Input
          value={sector}
          onChange={(e) => setSector(e.target.value)}
          placeholder="Marketing digital, Data Science…"
          onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addSector())}
        />
        <Button variant="secondary" size="sm" onClick={addSector}>
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      <p className="text-caption uppercase text-textSecondary mb-2">
        Pays ({profile.target_countries.length})
      </p>
      <div className="flex flex-wrap gap-1.5 mb-1.5">
        {profile.target_countries.map((c) => (
          <Chip key={c} active onRemove={() => toggleCountry(c)}>
            {c}
          </Chip>
        ))}
      </div>
      <button
        onClick={() => setShowCountries((v) => !v)}
        className="text-small text-accent hover:underline mb-3"
      >
        {showCountries ? "Masquer la liste" : "+ Ajouter des pays"}
      </button>
      {showCountries && (
        <div className="space-y-3 mb-4 max-h-72 overflow-y-auto pr-2 border-t border-border pt-3">
          {COUNTRY_GROUPS.map((g) => (
            <div key={g.region}>
              <p className="text-caption uppercase tracking-wide text-textSecondary mb-1.5">
                {g.region}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {g.countries.map((c) => (
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
      )}

      <p className="text-caption uppercase text-textSecondary mb-2">Contrats recherchés</p>
      <div className="flex flex-wrap gap-1.5 mb-4">
        {(
          [
            ["cdi", "CDI"],
            ["cdd", "CDD"],
            ["vie", "V.I.E"],
            ["stage", "Stage"],
            ["alternance", "Alternance"],
          ] as const
        ).map(([id, label]) => {
          const prefs = profile.preferred_contracts ?? ["cdi", "cdd"];
          const has = prefs.includes(id);
          return (
            <Chip
              key={id}
              active={has}
              onClick={() =>
                update({
                  preferred_contracts: has ? prefs.filter((x) => x !== id) : [...prefs, id],
                })
              }
            >
              {label}
            </Chip>
          );
        })}
      </div>

      <p className="text-caption uppercase text-textSecondary mb-2">Sources</p>
      <div className="flex flex-wrap gap-1.5">
        {SOURCES.map((s) => (
          <Chip
            key={s.id}
            active={profile.sources_enabled.includes(s.id)}
            onClick={() => toggleSource(s.id)}
          >
            {s.label}
          </Chip>
        ))}
      </div>
      <EngineNotice
        active={profile.sources_enabled.includes("linkedin")}
        className="mt-3"
      />
    </Card>
  );
}

// ============================================================
// Experiences
// ============================================================

function ExperiencesCard({
  profile,
  update,
}: {
  profile: ProfileFull;
  update: (p: Partial<ProfileFull>) => void;
}) {
  const [openIdx, setOpenIdx] = useState<Set<number>>(new Set());
  function toggle(i: number) {
    setOpenIdx((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }
  const allOpen = openIdx.size === profile.experiences.length && profile.experiences.length > 0;
  function expandAll() {
    setOpenIdx(allOpen ? new Set() : new Set(profile.experiences.map((_, i) => i)));
  }

  function patch(i: number, p: Partial<Experience>) {
    const exp = [...profile.experiences];
    exp[i] = { ...exp[i], ...p };
    update({ experiences: exp });
  }
  function remove(i: number) {
    if (!confirm("Supprimer cette expérience ?")) return;
    update({ experiences: profile.experiences.filter((_, j) => j !== i) });
    setOpenIdx((prev) => {
      const next = new Set<number>();
      for (const idx of prev) {
        if (idx < i) next.add(idx);
        else if (idx > i) next.add(idx - 1);
      }
      return next;
    });
  }
  function add() {
    update({
      experiences: [
        {
          title: "Nouveau poste",
          company: "",
          location: null,
          start_date: null,
          end_date: null,
          description: null,
          bullet_points: [],
          skills_used: [],
        },
        ...profile.experiences,
      ],
    });
    // Open the freshly-added one (now at index 0)
    setOpenIdx((prev) => {
      const shifted = new Set<number>();
      for (const idx of prev) shifted.add(idx + 1);
      shifted.add(0);
      return shifted;
    });
  }

  return (
    <Card className="md:col-span-2">
      <SectionHead
        icon={<Briefcase className="h-4 w-4" />}
        title={`Expériences (${profile.experiences.length})`}
        action={
          <div className="flex gap-1.5">
            {profile.experiences.length > 0 && (
              <Button variant="ghost" size="sm" onClick={expandAll}>
                {allOpen ? "Tout replier" : "Tout déplier"}
              </Button>
            )}
            <Button size="sm" onClick={add}>
              <Plus className="h-4 w-4" /> Ajouter
            </Button>
          </div>
        }
      />
      <div className="space-y-2">
        {profile.experiences.length === 0 && (
          <p className="text-small text-textSecondary py-4 text-center">
            Aucune expérience.
          </p>
        )}
        {profile.experiences.map((e, i) => (
          <ExperienceItem
            key={i}
            exp={e}
            open={openIdx.has(i)}
            onToggle={() => toggle(i)}
            onChange={(p) => patch(i, p)}
            onDelete={() => remove(i)}
          />
        ))}
      </div>
    </Card>
  );
}

function ExperienceItem({
  exp,
  open,
  onToggle,
  onChange,
  onDelete,
}: {
  exp: Experience;
  open: boolean;
  onToggle: () => void;
  onChange: (p: Partial<Experience>) => void;
  onDelete: () => void;
}) {
  function setBullet(idx: number, value: string) {
    const next = [...exp.bullet_points];
    next[idx] = value;
    onChange({ bullet_points: next });
  }
  function removeBullet(idx: number) {
    onChange({ bullet_points: exp.bullet_points.filter((_, i) => i !== idx) });
  }
  function addBullet() {
    onChange({ bullet_points: [...exp.bullet_points, ""] });
  }

  const dateLabel = [exp.start_date, exp.end_date]
    .filter(Boolean)
    .map((d) => (d === "present" ? "Aujourd'hui" : d))
    .join(" – ");

  return (
    <div className="border border-border rounded-md overflow-hidden">
      {/* Header — always visible */}
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center gap-3 p-3 hover:bg-surface transition-colors text-left"
      >
        <ChevronDown
          className={cn(
            "h-4 w-4 text-textSecondary shrink-0 transition-transform",
            open && "rotate-180"
          )}
        />
        <div className="flex-1 min-w-0">
          <p className="text-body font-medium truncate">
            {exp.title || "Sans titre"}
            {exp.company ? <span className="text-textSecondary"> — {exp.company}</span> : null}
          </p>
          {dateLabel && (
            <p className="text-caption text-textSecondary truncate">
              {dateLabel}
              {exp.location ? ` · ${exp.location}` : ""}
              {exp.bullet_points.length > 0 ? ` · ${exp.bullet_points.length} mission${exp.bullet_points.length > 1 ? "s" : ""}` : ""}
            </p>
          )}
        </div>
      </button>

      {open && (
        <div className="p-4 pt-2 border-t border-border space-y-3 animate-fadeIn">
          <div className="grid grid-cols-2 gap-3">
        <Field label="Poste">
          <Input value={exp.title} onChange={(e) => onChange({ title: e.target.value })} />
        </Field>
        <Field label="Entreprise">
          <Input
            value={exp.company ?? ""}
            onChange={(e) => onChange({ company: e.target.value })}
          />
        </Field>
        <Field label="Début (YYYY-MM)">
          <Input
            value={exp.start_date ?? ""}
            placeholder="2023-01"
            onChange={(e) => onChange({ start_date: e.target.value || null })}
          />
        </Field>
        <Field label="Fin (YYYY-MM ou 'present')">
          <Input
            value={exp.end_date ?? ""}
            placeholder="present"
            onChange={(e) => onChange({ end_date: e.target.value || null })}
          />
        </Field>
        <Field label="Localisation">
          <Input
            value={exp.location ?? ""}
            onChange={(e) => onChange({ location: e.target.value || null })}
          />
        </Field>
      </div>
      <Field label="Description">
        <Textarea
          value={exp.description ?? ""}
          rows={2}
          onChange={(e) => onChange({ description: e.target.value || null })}
        />
      </Field>
      <Field label={`Missions / réalisations (${exp.bullet_points.length})`}>
        <div className="space-y-1.5">
          {exp.bullet_points.map((b, i) => (
            <div key={i} className="flex gap-2">
              <Input value={b} onChange={(e) => setBullet(i, e.target.value)} />
              <Button
                variant="ghost"
                size="icon"
                onClick={() => removeBullet(i)}
                title="Supprimer"
              >
                <Trash2 className="h-4 w-4 text-textSecondary" />
              </Button>
            </div>
          ))}
          <Button variant="secondary" size="sm" onClick={addBullet}>
            <Plus className="h-3.5 w-3.5" /> Ajouter une mission
          </Button>
        </div>
      </Field>
          <ChipListField
            label="Compétences utilisées"
            items={exp.skills_used}
            onChange={(items) => onChange({ skills_used: items })}
          />
          <div className="flex justify-end pt-1">
            <Button variant="ghost" size="sm" onClick={onDelete}>
              <Trash2 className="h-4 w-4 text-danger" />
              Supprimer cette expérience
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================
// Educations
// ============================================================

function EducationsCard({
  profile,
  update,
}: {
  profile: ProfileFull;
  update: (p: Partial<ProfileFull>) => void;
}) {
  const [openIdx, setOpenIdx] = useState<Set<number>>(new Set());
  function toggle(i: number) {
    setOpenIdx((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }
  const allOpen = openIdx.size === profile.educations.length && profile.educations.length > 0;
  function expandAll() {
    setOpenIdx(allOpen ? new Set() : new Set(profile.educations.map((_, i) => i)));
  }

  function patch(i: number, p: Partial<Education>) {
    const edu = [...profile.educations];
    edu[i] = { ...edu[i], ...p };
    update({ educations: edu });
  }
  function remove(i: number) {
    if (!confirm("Supprimer cette formation ?")) return;
    update({ educations: profile.educations.filter((_, j) => j !== i) });
    setOpenIdx((prev) => {
      const next = new Set<number>();
      for (const idx of prev) {
        if (idx < i) next.add(idx);
        else if (idx > i) next.add(idx - 1);
      }
      return next;
    });
  }
  function add() {
    update({
      educations: [
        {
          school: "Nouvelle école",
          degree: null,
          field: null,
          location: null,
          start_date: null,
          end_date: null,
          description: null,
        },
        ...profile.educations,
      ],
    });
    setOpenIdx((prev) => {
      const shifted = new Set<number>();
      for (const idx of prev) shifted.add(idx + 1);
      shifted.add(0);
      return shifted;
    });
  }

  return (
    <Card className="md:col-span-2">
      <SectionHead
        icon={<GraduationCap className="h-4 w-4" />}
        title={`Formations (${profile.educations.length})`}
        action={
          <div className="flex gap-1.5">
            {profile.educations.length > 0 && (
              <Button variant="ghost" size="sm" onClick={expandAll}>
                {allOpen ? "Tout replier" : "Tout déplier"}
              </Button>
            )}
            <Button size="sm" onClick={add}>
              <Plus className="h-4 w-4" /> Ajouter
            </Button>
          </div>
        }
      />
      <div className="space-y-2">
        {profile.educations.length === 0 && (
          <p className="text-small text-textSecondary py-4 text-center">
            Aucune formation.
          </p>
        )}
        {profile.educations.map((e, i) => (
          <EducationItem
            key={i}
            edu={e}
            open={openIdx.has(i)}
            onToggle={() => toggle(i)}
            onChange={(p) => patch(i, p)}
            onDelete={() => remove(i)}
          />
        ))}
      </div>
    </Card>
  );
}

function EducationItem({
  edu,
  open,
  onToggle,
  onChange,
  onDelete,
}: {
  edu: Education;
  open: boolean;
  onToggle: () => void;
  onChange: (p: Partial<Education>) => void;
  onDelete: () => void;
}) {
  const dateLabel = [edu.start_date, edu.end_date].filter(Boolean).join(" – ");
  const heading =
    [edu.degree, edu.field].filter(Boolean).join(" — ") || edu.school || "Sans titre";

  return (
    <div className="border border-border rounded-md overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center gap-3 p-3 hover:bg-surface transition-colors text-left"
      >
        <ChevronDown
          className={cn(
            "h-4 w-4 text-textSecondary shrink-0 transition-transform",
            open && "rotate-180"
          )}
        />
        <div className="flex-1 min-w-0">
          <p className="text-body font-medium truncate">{heading}</p>
          <p className="text-caption text-textSecondary truncate">
            {edu.school}
            {dateLabel ? ` · ${dateLabel}` : ""}
          </p>
        </div>
      </button>

      {open && (
        <div className="p-4 pt-2 border-t border-border space-y-3 animate-fadeIn">
          <div className="grid grid-cols-2 gap-3">
            <Field label="École / institution">
              <Input value={edu.school} onChange={(e) => onChange({ school: e.target.value })} />
            </Field>
            <Field label="Diplôme">
              <Input
                value={edu.degree ?? ""}
                onChange={(e) => onChange({ degree: e.target.value || null })}
              />
            </Field>
            <Field label="Spécialité">
              <Input
                value={edu.field ?? ""}
                onChange={(e) => onChange({ field: e.target.value || null })}
              />
            </Field>
            <Field label="Localisation">
              <Input
                value={edu.location ?? ""}
                onChange={(e) => onChange({ location: e.target.value || null })}
              />
            </Field>
            <Field label="Début (YYYY-MM)">
              <Input
                value={edu.start_date ?? ""}
                placeholder="2018-09"
                onChange={(e) => onChange({ start_date: e.target.value || null })}
              />
            </Field>
            <Field label="Fin (YYYY-MM)">
              <Input
                value={edu.end_date ?? ""}
                placeholder="2021-06"
                onChange={(e) => onChange({ end_date: e.target.value || null })}
              />
            </Field>
          </div>
          <Field label="Description">
            <Textarea
              value={edu.description ?? ""}
              rows={2}
              onChange={(e) => onChange({ description: e.target.value || null })}
            />
          </Field>
          <div className="flex justify-end pt-1">
            <Button variant="ghost" size="sm" onClick={onDelete}>
              <Trash2 className="h-4 w-4 text-danger" />
              Supprimer cette formation
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================
// Skills
// ============================================================

function SkillsCard({
  profile,
  update,
}: {
  profile: ProfileFull;
  update: (p: Partial<ProfileFull>) => void;
}) {
  const [name, setName] = useState("");

  const add = () => {
    const v = name.trim();
    if (!v) return;
    if (profile.skills.some((s) => s.name.toLowerCase() === v.toLowerCase())) {
      setName("");
      return;
    }
    update({
      skills: [
        ...profile.skills,
        { name: v, category: null, level: null, evidence_experience_ids: [] },
      ],
    });
    setName("");
  };
  const remove = (i: number) => {
    update({ skills: profile.skills.filter((_, j) => j !== i) });
  };

  return (
    <Card className="md:col-span-2">
      <SectionHead
        icon={<Wrench className="h-4 w-4" />}
        title={`Compétences (${profile.skills.length})`}
      />
      <div className="flex flex-wrap gap-1.5 mb-3">
        {profile.skills.length === 0 && (
          <p className="text-small text-textSecondary py-2">
            Aucune compétence — ajoutez-en ci-dessous.
          </p>
        )}
        {profile.skills.map((s, i) => (
          <Badge
            key={i}
            variant={s.evidence_experience_ids.length > 0 ? "success" : "default"}
            className="pl-3 pr-1.5 py-1 gap-1.5 inline-flex items-center"
            title={
              s.evidence_experience_ids.length > 0
                ? "Compétence ancrée sur une expérience"
                : "Sans preuve d'expérience"
            }
          >
            {s.name}
            <button
              onClick={() => remove(i)}
              className="ml-1 opacity-60 hover:opacity-100"
              aria-label={`Supprimer ${s.name}`}
            >
              ×
            </button>
          </Badge>
        ))}
      </div>
      <div className="flex gap-2">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Ajouter une compétence"
          onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), add())}
        />
        <Button variant="secondary" onClick={add}>
          <Plus className="h-4 w-4" />
          Ajouter
        </Button>
      </div>
    </Card>
  );
}

// ============================================================
// Languages
// ============================================================

function LanguagesCard({
  profile,
  update,
}: {
  profile: ProfileFull;
  update: (p: Partial<ProfileFull>) => void;
}) {
  function patch(i: number, p: Partial<Language>) {
    const lang = [...profile.languages];
    lang[i] = { ...lang[i], ...p };
    update({ languages: lang });
  }
  function add() {
    update({ languages: [...profile.languages, { name: "", level: null }] });
  }
  function remove(i: number) {
    update({ languages: profile.languages.filter((_, j) => j !== i) });
  }

  return (
    <Card className="md:col-span-2">
      <SectionHead
        icon={<Languages className="h-4 w-4" />}
        title={`Langues (${profile.languages.length})`}
        action={
          <Button size="sm" onClick={add}>
            <Plus className="h-4 w-4" /> Ajouter
          </Button>
        }
      />
      <div className="space-y-2">
        {profile.languages.length === 0 && (
          <p className="text-small text-textSecondary py-2 text-center">
            Aucune langue.
          </p>
        )}
        {profile.languages.map((l, i) => (
          <div key={i} className="flex gap-2">
            <Input
              value={l.name}
              placeholder="Langue"
              onChange={(e) => patch(i, { name: e.target.value })}
            />
            <Input
              value={l.level ?? ""}
              placeholder="Niveau (B2, courant, natif…)"
              onChange={(e) => patch(i, { level: e.target.value || null })}
            />
            <Button variant="ghost" size="icon" onClick={() => remove(i)} title="Supprimer">
              <Trash2 className="h-4 w-4 text-textSecondary" />
            </Button>
          </div>
        ))}
      </div>
    </Card>
  );
}

// ============================================================
// Helpers
// ============================================================

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-caption font-medium text-textSecondary uppercase tracking-wide">
        {label}
      </span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

function SectionHead({
  icon,
  title,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <div className="h-7 w-7 rounded-md bg-surface flex items-center justify-center text-textSecondary">
        {icon}
      </div>
      <h2 className="text-h3">{title}</h2>
      <div className="flex-1" />
      {action}
    </div>
  );
}

function ChipListField({
  label,
  items,
  onChange,
}: {
  label: string;
  items: string[];
  onChange: (items: string[]) => void;
}) {
  const [val, setVal] = useState("");
  const add = () => {
    const v = val.trim();
    if (!v || items.includes(v)) {
      setVal("");
      return;
    }
    onChange([...items, v]);
    setVal("");
  };
  return (
    <Field label={label}>
      <div className="flex flex-wrap gap-1.5 mb-2">
        {items.map((s) => (
          <Badge key={s} variant="info" className="pl-3 pr-1.5 py-1 gap-1.5 inline-flex items-center">
            {s}
            <button
              onClick={() => onChange(items.filter((x) => x !== s))}
              className="ml-1 opacity-60 hover:opacity-100"
            >
              ×
            </button>
          </Badge>
        ))}
      </div>
      <div className="flex gap-2">
        <Input
          value={val}
          onChange={(e) => setVal(e.target.value)}
          placeholder="Ajouter une compétence ancrée"
          onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), add())}
        />
        <Button variant="secondary" size="sm" onClick={add}>
          <Plus className="h-3.5 w-3.5" />
        </Button>
      </div>
    </Field>
  );
}
