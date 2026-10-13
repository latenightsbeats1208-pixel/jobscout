"use client";
import { useEffect, useMemo, useRef, useState } from "react";
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
  Check,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Input, Textarea } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Chip } from "@/components/ui/chip";
import { Spinner } from "@/components/ui/spinner";
import { SearchAreaSelect, SearchPlanPreview } from "@/components/app/search-area";
import { TitleSuggestions } from "@/components/app/title-suggestions";
import { cn } from "@/lib/utils";
import { COUNTRY_GROUPS } from "@/lib/countries";
import { SOURCES_META } from "@/lib/sources-meta";
import { EngineNotice } from "@/components/app/engine-notice";
import type { ProfileFull, Experience, Education, Skill, Language } from "@/lib/cv/types";

const SOURCES = SOURCES_META;
const PROFILE_SECTIONS = [["#identite", "Identité"], ["#recherche", "Recherche"], ["#experiences", "Expériences"], ["#formations", "Formations"], ["#competences", "Compétences"], ["#langues", "Langues"], ["#parametres", "Paramètres"]] as const;
const NO_SOURCE_MESSAGE = "Aucune source cochée : cochez au moins une source dans Recherche › Sources, puis enregistrez.";

/**
 * Section visible à l'écran, pour la pastille active de la navigation.
 * Bande d'observation : sous l'en-tête et la barre d'enregistrement collantes (~120 px),
 * jusqu'à mi-hauteur de la fenêtre ; la première section de la bande l'emporte.
 */
function useActiveSection(): [string, (href: string) => void] {
  const [active, setActive] = useState<string>(PROFILE_SECTIONS[0][0]);
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const visible = new Set<string>();
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) visible.add(`#${entry.target.id}`);
        else visible.delete(`#${entry.target.id}`);
      }
      const first = PROFILE_SECTIONS.find(([href]) => visible.has(href));
      if (first) setActive(first[0]);
    }, { rootMargin: "-120px 0px -50% 0px" });
    for (const [href] of PROFILE_SECTIONS) {
      const element = document.getElementById(href.slice(1));
      if (element) observer.observe(element);
    }
    return () => observer.disconnect();
  }, []);
  return [active, setActive];
}

export function ProfileEditor({ initial }: { initial: ProfileFull }) {
  const router = useRouter();
  const [profile, setProfile] = useState<ProfileFull>(initial);
  const [baseline, setBaseline] = useState<ProfileFull>(initial);
  const lastInitial = useRef(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedTick, setSavedTick] = useState(false);
  const [activeSection, setActiveSection] = useActiveSection();

  const dirty = useMemo(
    () => JSON.stringify(profile) !== JSON.stringify(baseline),
    [profile, baseline]
  );

  useEffect(() => {
    if (lastInitial.current !== initial) {
      lastInitial.current = initial;
      if (!dirty) {
        setProfile(initial);
        setBaseline(initial);
      }
    }
  }, [initial, dirty]);

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
    // U9 : garde-fou « aucune source cochée ». L'orchestrateur se replierait sur les sources
    // par défaut, mais un profil enregistré sans source ne dit plus ce qui sera parcouru.
    if (profile.sources_enabled.length === 0) {
      setError(NO_SOURCE_MESSAGE);
      document.getElementById("recherche")?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
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
      setBaseline(profile);
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
    setProfile(baseline);
    setError(null);
  }

  return (
    <div className="lg:grid lg:grid-cols-[176px_minmax(0,1fr)] lg:gap-7">
      <nav aria-label="Sections du profil" className="glass-panel sticky top-6 hidden self-start p-2 lg:flex lg:flex-col">
        <p className="px-3 pb-2 pt-2 text-caption font-semibold uppercase tracking-[0.12em] text-textSecondary">Votre profil</p>
        {PROFILE_SECTIONS.map(([href, label]) => <a key={href} href={href} onClick={() => setActiveSection(href)} aria-current={activeSection === href ? "location" : undefined} className={cn("rounded-md px-3 py-2.5 text-small font-semibold transition-colors", activeSection === href ? "bg-accent text-onAccent" : "text-textSecondary hover:bg-surfaceHover hover:text-text")}>{label}</a>)}
      </nav>
      <div className="min-w-0">
      <nav aria-label="Sections du profil" className="mb-6 flex gap-2 overflow-x-auto pb-2 lg:hidden">
        {PROFILE_SECTIONS.map(([href, label]) => <a key={href} href={href} onClick={() => setActiveSection(href)} aria-current={activeSection === href ? "location" : undefined} className={cn("flex min-h-11 shrink-0 items-center rounded-md border px-3 text-small font-semibold transition-colors", activeSection === href ? "border-accent bg-accent text-onAccent" : "border-border bg-surface text-textSecondary hover:border-accent hover:text-text")}>{label}</a>)}
      </nav>
      {/* Sticky save bar */}
      {(dirty || savedTick) && (
        <div className="glass-panel sticky top-20 z-30 mb-5 flex flex-wrap items-center gap-3 !rounded-[16px] px-4 py-3 animate-fadeIn lg:top-6">
          <span className="text-small">
            {savedTick ? (
              <span className="inline-flex items-center gap-1.5 text-text"><Check className="h-4 w-4 text-success" aria-hidden="true" /> Modifications enregistrées</span>
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
                {saving ? <Spinner size={14} className="text-onAccent" /> : <Save className="h-4 w-4" />}
                Enregistrer
              </Button>
            </>
          )}
        </div>
      )}
      {error && (
        <div role="alert" className="mb-5 rounded-md border border-danger bg-surface p-3 text-small text-text">
          {error}
        </div>
      )}

      <div className="space-y-5">
        <IdentityCard profile={profile} update={update} />
        <SearchCard profile={profile} update={update} />

        <ExperiencesCard profile={profile} update={update} />
        <EducationsCard profile={profile} update={update} />
        <SkillsCard profile={profile} update={update} />
        <LanguagesCard profile={profile} update={update} />
      </div>
      </div>
    </div>
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
    <Card id="identite" className="scroll-mt-28">
      <SectionHead icon={<User className="h-4 w-4" />} title="Identité" />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
    <Card id="recherche" className="scroll-mt-28">
      <SectionHead icon={<Globe className="h-4 w-4" />} title="Recherche" />

      <ChipListField
        label="Postes visés"
        items={profile.target_titles ?? []}
        onChange={(target_titles) => update({ target_titles })}
        placeholder="Ex. Business Analyst, Développeur .NET…"
      />
      <p className="text-small text-textSecondary mt-2">
        Chaque source cherche ces intitulés, et chaque offre est notée d'abord sur la proximité de son titre avec eux.
      </p>
      <div className="mb-4">
        <TitleSuggestions
          profile={profile}
          current={profile.target_titles ?? []}
          onAdd={(title) => update({ target_titles: [...(profile.target_titles ?? []), title] })}
        />
      </div>

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
          placeholder="Ex. Logistique, Comptabilité, Santé…"
          onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addSector())}
        />
        <Button variant="secondary" size="sm" onClick={addSector}>
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      <div className="mb-4 space-y-3">
        <SearchAreaSelect value={profile.search_area ?? ""} onChange={(search_area) => update({ search_area })} />
        <SearchPlanPreview profile={profile} />
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
            ["interim", "Intérim"],
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
        {SOURCES.map((s) => {
          const active = profile.sources_enabled.includes(s.id);
          return s.unavailable && !active ? (
            <span key={s.id} title={s.sublabel} className="inline-flex h-11 items-center rounded-md border border-border px-3 text-small text-textSecondary opacity-60">{s.label} · suspendue</span>
          ) : (
            <Chip key={s.id} active={active} onClick={() => toggleSource(s.id)}>{s.label}</Chip>
          );
        })}
      </div>
      {profile.sources_enabled.length === 0 && (
        <p role="alert" className="mt-3 rounded-md border border-danger bg-surface px-3 py-2 text-small text-text">{NO_SOURCE_MESSAGE}</p>
      )}
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
    <Card id="experiences" className="scroll-mt-28 md:col-span-2">
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
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
            placeholder="AAAA-MM"
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
    <Card id="formations" className="scroll-mt-28 md:col-span-2">
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
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
                placeholder="AAAA-MM"
                onChange={(e) => onChange({ start_date: e.target.value || null })}
              />
            </Field>
            <Field label="Fin (YYYY-MM)">
              <Input
                value={edu.end_date ?? ""}
                placeholder="AAAA-MM"
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
    <Card id="competences" className="scroll-mt-28 md:col-span-2">
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
              className="ml-1 transition-opacity hover:opacity-70"
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
    <Card id="langues" className="scroll-mt-28 md:col-span-2">
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
    <div className="mb-5 flex flex-wrap items-center gap-3">
      <div className="flex min-w-0 items-center gap-2.5">
        <span className="brand-mark h-8 w-8 rounded-[11px]">{icon}</span>
        <h2 className="font-display text-h3">{title}</h2>
      </div>
      {action && <div className="ml-auto flex flex-wrap items-center gap-2">{action}</div>}
    </div>
  );
}

function ChipListField({
  label,
  items,
  onChange,
  placeholder = "Ajouter une compétence ancrée",
}: {
  label: string;
  items: string[];
  onChange: (items: string[]) => void;
  placeholder?: string;
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
              className="ml-1 transition-opacity hover:opacity-70"
              aria-label={`Supprimer ${s}`}
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
          placeholder={placeholder}
          onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), add())}
        />
        <Button variant="secondary" size="sm" onClick={add}>
          <Plus className="h-3.5 w-3.5" />
        </Button>
      </div>
    </Field>
  );
}
