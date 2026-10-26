/**
 * Choix déterministe dans le modèle de CV : cluster, puces, titre, mots-clés.
 * Aucune dépendance serveur ni appel IA — c'est aussi le repli quand l'IA est
 * absente ou répond mal, et le garde-fou qui valide chaque choix de l'IA.
 */
import { cleanJobTitle } from "@/lib/text/typography";
import type { DocLang } from "@/lib/text/lang";
import { bulletGroup, type Bullet, type Cluster, type CvTemplate, type Entry } from "./types";

export type OffreLike = { title: string; description_text: string; country?: string | null };

export type Selection = {
  cluster: string;
  headline: string;
  /** Puces retenues par entrée (ids, dans l'ordre de rendu) ; entrée absente = non rendue. */
  bullets: Record<string, string[]>;
  extraSkills: string[];
  mode: "auto" | "ai";
  reason?: string;
};

// ------------------------------------------------------------------ texte

/** Minuscules, sans accents, ponctuation → espaces : base des comparaisons de mots-clés. */
export function normalize(s: string): string {
  return ` ${s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9+#]+/g, " ")
    .trim()} `;
}

/** Le terme apparaît-il comme suite de mots entiers dans le texte (déjà normalisé) ? */
export function hasTerm(normText: string, term: string): boolean {
  const t = normalize(term);
  return t.trim().length >= 2 && normText.includes(t);
}

const PLACEHOLDER = /\[[^\]\n]{1,60}\]/g;

/** Emplacements non remplis (« [N] », « [mois] 2025 ») d'un texte. */
export function findPlaceholders(text: string): string[] {
  return text.match(PLACEHOLDER) ?? [];
}

// ---------------------------------------------------------------- cluster

export function scoreClusters(t: CvTemplate, offre: OffreLike): { id: string; score: number }[] {
  const title = normalize(offre.title);
  const body = normalize(`${offre.title} ${offre.description_text}`);
  const scores = t.clusters.map((c) => {
    const titleTerms = c.titles.split(/[,/;]/).map((s) => s.trim()).filter(Boolean);
    let score = 0;
    for (const term of titleTerms) if (hasTerm(title, term)) score += 4;
    for (const kw of c.keywords) {
      if (hasTerm(title, kw)) score += 3;
      else if (hasTerm(body, kw)) score += 1;
    }
    return { id: c.id, score };
  });
  // Tri stable : à égalité, l'ordre du modèle départage (le premier cluster est le défaut).
  return scores.sort((a, b) => b.score - a.score);
}

export function pickCluster(t: CvTemplate, offre: OffreLike): Cluster {
  const best = scoreClusters(t, offre)[0];
  return t.clusters.find((c) => c.id === best.id) ?? t.clusters[0];
}

// ------------------------------------------------------------------ puces

function servesCluster(b: Bullet, clusterId: string): boolean {
  return b.clusters.includes("*") || b.clusters.includes(clusterId);
}

/** Ajoute une puce si son fait n'est pas déjà présent (même groupe, ou résumé par une puce « covers »). */
function tryAdd(picked: Bullet[], b: Bullet): boolean {
  const g = bulletGroup(b);
  for (const p of picked) {
    if (p.id === b.id || bulletGroup(p) === g) return false;
    if (p.covers.includes(g)) return false;
    if (b.covers.includes(bulletGroup(p))) return false;
  }
  picked.push(b);
  return true;
}

export function entryLimit(entry: Entry, cluster: Cluster): number {
  return cluster.limits[entry.id] ?? entry.max_bullets;
}

/**
 * Puces d'une entrée pour un cluster : celles du cluster d'abord (priorités du
 * cluster, puis ordre du modèle), complétées jusqu'à `min_bullets` avec les
 * autres. `proposed` (choix de l'IA) passe en premier, filtré par les mêmes règles.
 */
export function selectEntryBullets(entry: Entry, cluster: Cluster, proposed?: string[]): Bullet[] | null {
  const max = entryLimit(entry, cluster);
  const min = Math.min(entry.min_bullets, max);
  const picked: Bullet[] = [];
  if (max === 0) return entry.always ? [] : null;

  if (proposed) {
    const byId = new Map(entry.bullets.map((b) => [b.id, b]));
    for (const id of proposed) {
      const b = byId.get(id);
      if (b && picked.length < max) tryAdd(picked, b);
    }
    // L'IA a écarté une entrée facultative : on la respecte.
    if (picked.length === 0 && !entry.always) return null;
  } else {
    const rank = (b: Bullet) => {
      const i = cluster.priority.indexOf(b.id);
      return i === -1 ? Number.MAX_SAFE_INTEGER : i;
    };
    const tagged = entry.bullets
      .map((b, i) => ({ b, i }))
      .filter(({ b }) => servesCluster(b, cluster.id))
      .sort((x, y) => rank(x.b) - rank(y.b) || x.i - y.i)
      .map(({ b }) => b);
    for (const b of tagged) if (picked.length < max) tryAdd(picked, b);
    if (picked.length === 0 && !entry.always) return null;
  }
  for (const b of entry.bullets) if (picked.length < min) tryAdd(picked, b);
  return picked;
}

/** Puces de toutes les entrées des sections du cluster. */
export function selectBullets(
  t: CvTemplate,
  cluster: Cluster,
  proposed?: Record<string, string[]>
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const sectionId of cluster.order) {
    const section = t.sections.find((s) => s.id === sectionId);
    if (!section) continue;
    for (const entry of section.entries) {
      const fromAi = proposed && Object.prototype.hasOwnProperty.call(proposed, entry.id) ? proposed[entry.id] : undefined;
      const picked = selectEntryBullets(entry, cluster, fromAi);
      if (picked) out[entry.id] = picked.map((b) => b.id);
    }
  }
  return out;
}

// ------------------------------------------------------------------ titre

const CONTRACT_SEGMENT =
  /^(cdi|cdd|stage|stagiaire|alternance|apprentissage|interim|intérim|freelance|temps plein|full[- ]time|permanent|vie|v\.i\.e\.?|\d{2,5}|\(?\d{2,3}\)?)$/i;

/** Intitulé de l'offre sans marques de genre ni suffixes de contrat (« - CDI », « (H/F) »). */
export function cleanHeadline(title: string): string {
  let t = cleanJobTitle(title);
  // Segments de fin « - CDI », « | Stage », « (CDI) ».
  for (let i = 0; i < 3; i++) {
    const m = /\s*(?:[-–—|]\s*|\()\s*([^-–—|()]+?)\s*\)?\s*$/.exec(t);
    if (!m || !CONTRACT_SEGMENT.test(m[1].trim())) break;
    t = t.slice(0, m.index).trim();
  }
  t = t.replace(/\s+(?:en\s+)?(?:cdi|cdd)$/i, "").trim();
  return t.length > 100 ? `${t.slice(0, 97).trimEnd()}…` : t;
}

/**
 * Titre proposé (IA) accepté seulement s'il reprend les mots de l'offre :
 * le CV doit porter l'intitulé exact de l'annonce, jamais un titre inventé.
 */
export function acceptHeadline(proposed: string | null | undefined, offreTitle: string): string | null {
  const p = (proposed ?? "").trim();
  if (!p || p.length > 100) return null;
  const source = normalize(offreTitle);
  const words = normalize(p).trim().split(" ").filter(Boolean);
  return words.length > 0 && words.every((w) => source.includes(` ${w} `)) ? p : null;
}

// -------------------------------------------------------------- mots-clés

type Term = { main: string; twin: string | null };

/** « intégration de LLM (LLM integration) » → { main, twin } ; « notions : PySpark » → PySpark. */
function splitItems(items: string): Term[] {
  const out: Term[] = [];
  // Virgules hors parenthèses.
  const parts: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of items) {
    if (ch === "(") depth++;
    if (ch === ")") depth = Math.max(0, depth - 1);
    if ((ch === "," || ch === ";") && depth === 0) {
      parts.push(cur);
      cur = "";
    } else cur += ch;
  }
  parts.push(cur);
  for (const raw of parts) {
    const p = raw.replace(/^[^:()]{1,20}:\s*/, "").trim();
    if (!p) continue;
    const m = /^(.*?)\s*\(([^)]*)\)\s*$/.exec(p);
    if (m && m[1].trim()) out.push({ main: m[1].trim(), twin: m[2].trim() || null });
    else out.push({ main: p, twin: null });
  }
  return out;
}

export function skillTerms(items: string): string[] {
  return splitItems(items).flatMap((t) => [t.main, ...(t.twin ? t.twin.split(",").map((s) => s.trim()) : [])]);
}

/** Vocabulaire défendable : tous les blocs de compétences du modèle + mots-clés confirmés. */
function vocabulary(t: CvTemplate): Term[] {
  const terms: Term[] = [];
  for (const c of t.clusters) for (const line of c.skills.fr) terms.push(...splitItems(line.items));
  for (const k of t.extra_keywords) terms.push({ main: k, twin: null });
  return terms;
}

/** Termes du bloc de compétences du cluster (normalisés), dans les deux langues. */
function blockTerms(cluster: Cluster): Set<string> {
  const set = new Set<string>();
  for (const line of [...cluster.skills.fr, ...cluster.skills.en])
    for (const term of skillTerms(line.items)) set.add(normalize(term));
  return set;
}

/**
 * Jusqu'à `max` termes de l'offre, absents du bloc du cluster mais présents
 * ailleurs dans vos compétences : « 3 à 5 termes exacts de l'annonce que vous
 * savez défendre ». `proposed` (IA) n'est retenu que s'il passe les mêmes filtres.
 */
export function extraSkills(
  t: CvTemplate,
  cluster: Cluster,
  offre: OffreLike,
  lang: DocLang,
  proposed?: string[],
  max = 5
): string[] {
  const title = normalize(offre.title);
  const body = normalize(`${offre.title} ${offre.description_text}`);
  const inBlock = blockTerms(cluster);
  const seen = new Set<string>();
  const candidates: { label: string; inTitle: boolean; order: number }[] = [];
  const vocab = vocabulary(t);
  const display = (term: Term) => (lang === "en" && term.twin ? term.twin.split(",")[0].trim() : term.main);

  vocab.forEach((term, order) => {
    const forms = [term.main, ...(term.twin ? term.twin.split(",").map((s) => s.trim()) : [])];
    if (forms.some((f) => inBlock.has(normalize(f)))) return;
    const hit = forms.find((f) => hasTerm(body, f));
    if (!hit) return;
    const label = display(term);
    const key = normalize(label);
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push({ label, inTitle: forms.some((f) => hasTerm(title, f)), order });
  });

  if (proposed) {
    const allowed = new Map(candidates.map((c) => [normalize(c.label), c.label]));
    const fromAi = proposed.map((p) => allowed.get(normalize(p))).filter((x): x is string => Boolean(x));
    return [...new Set(fromAi)].slice(0, max);
  }
  return candidates
    .sort((a, b) => Number(b.inTitle) - Number(a.inTitle) || a.order - b.order)
    .slice(0, max)
    .map((c) => c.label);
}

// ---------------------------------------------------------------- ensemble

/** Choix complet sans IA. */
export function autoSelection(t: CvTemplate, offre: OffreLike, lang: DocLang): Selection {
  const cluster = pickCluster(t, offre);
  return {
    cluster: cluster.id,
    headline: cleanHeadline(offre.title) || (lang === "en" && cluster.headline.en ? cluster.headline.en : cluster.headline.fr),
    bullets: selectBullets(t, cluster),
    extraSkills: extraSkills(t, cluster, offre, lang),
    mode: "auto",
  };
}

/** Valide un choix proposé (IA) contre le modèle ; tout ce qui ne passe pas retombe sur le choix automatique. */
export function validateSelection(
  t: CvTemplate,
  offre: OffreLike,
  lang: DocLang,
  proposed: { cluster?: unknown; headline?: unknown; bullets?: unknown; extra_skills?: unknown; reason?: unknown }
): Selection {
  const cluster = t.clusters.find((c) => c.id === proposed.cluster) ?? pickCluster(t, offre);
  const bullets: Record<string, string[]> = {};
  if (proposed.bullets && typeof proposed.bullets === "object") {
    const list = Array.isArray(proposed.bullets) ? proposed.bullets : Object.entries(proposed.bullets).map(([entry, ids]) => ({ entry, ids }));
    for (const item of list as { entry?: unknown; ids?: unknown }[]) {
      if (typeof item?.entry === "string" && Array.isArray(item.ids))
        bullets[item.entry] = item.ids.filter((x): x is string => typeof x === "string");
    }
  }
  const headline =
    acceptHeadline(typeof proposed.headline === "string" ? proposed.headline : null, offre.title) ??
    (cleanHeadline(offre.title) || (lang === "en" && cluster.headline.en ? cluster.headline.en : cluster.headline.fr));
  const extra = Array.isArray(proposed.extra_skills)
    ? extraSkills(t, cluster, offre, lang, proposed.extra_skills.filter((x): x is string => typeof x === "string"))
    : extraSkills(t, cluster, offre, lang);
  return {
    cluster: cluster.id,
    headline,
    bullets: selectBullets(t, cluster, bullets),
    extraSkills: extra,
    mode: "ai",
    reason: typeof proposed.reason === "string" ? proposed.reason.slice(0, 400) : undefined,
  };
}
