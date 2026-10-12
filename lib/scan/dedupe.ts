import { normalize, tokenize } from "@/lib/scoring/text";

/**
 * Même offre publiée plusieurs fois : même entreprise, même intitulé, même pays.
 * Cas mesurés sur 623 offres (octobre 2026) : une annonce par ville (« Mécanicien
 * service rapide » dans 6 villes), une même carte répétée sous plusieurs
 * identifiants (Talent.com), la même offre sur deux sources (WTTJ et HelloWork).
 *
 * Le nom de l'entreprise s'écrit différemment d'une source à l'autre (« Civils de
 * la Défense - Ministère des Armées… » sur WTTJ, « Ministère des armées - Civils
 * de la Défense » sur HelloWork) : deux noms correspondent quand les mots
 * distinctifs de l'un sont tous dans l'autre.
 *
 * La description n'entre pas dans la clé : une agence d'intérim publie le même
 * poste pour plusieurs clients avec des textes différents, et c'est bien une
 * seule opportunité « dans 5 lieux » pour qui cherche. Sans entreprise connue,
 * rien n'est regroupé : deux « Agent de service » anonymes n'ont rien en commun.
 */

export type DedupeInput = {
  id: number;
  title: string;
  company: string | null;
  country: string | null;
  location: string | null;
};

/** Formes juridiques et mots qui ne distinguent pas deux employeurs. */
const COMPANY_NOISE = new Set([
  "sa", "sas", "sasu", "sarl", "eurl", "sca", "sci", "scop", "snc", "gie", "gmbh", "ag", "ltd", "limited",
  "inc", "llc", "plc", "bv", "nv", "spa", "srl", "sl", "group", "groupe", "holding", "the",
  "cie", "co", "corp", "corporation", "company",
  // Mots de liaison : « Ministère des armées » = « ministere armees ».
  "de", "la", "le", "les", "des", "du", "et", "d", "l", "of", "and", "en", "au", "aux",
]);

const PLACEHOLDER_COMPANY = /confidenti|anonym|non communiqu|non precis|^(?:n ?c|n ?a|entreprise|societe|client|employeur|recruteur|cabinet)$/;

/** Entreprise ramenée à ses mots distinctifs ; null si inconnue ou anonyme. */
export function companyKey(company: string | null): string | null {
  const tokens = normalize(company ?? "")
    .split(/[^a-z0-9]+/)
    .filter((t) => t && !COMPANY_NOISE.has(t));
  if (!tokens.length || tokens.every((t) => /^\d+$/.test(t))) return null;
  const key = tokens.join(" ");
  return PLACEHOLDER_COMPANY.test(key) ? null : key;
}

/** Même employeur : les mots distinctifs du nom le plus court sont tous dans l'autre. */
export function sameCompany(a: string | null, b: string | null): boolean {
  const ka = companyKey(a);
  const kb = companyKey(b);
  if (!ka || !kb) return false;
  const [short, long] = [new Set(ka.split(" ")), new Set(kb.split(" "))].sort((x, y) => x.size - y.size);
  return [...short].every((t) => long.has(t));
}

/**
 * Intitulé sans marques de genre, ponctuation ni le lieu de l'offre (« Comptable -
 * Rouen »). Les nombres restent : tokenize les écarte, mais « Technicien niveau 2 »
 * et « niveau 3 », ou « CDD 6 mois » et « 12 mois », sont deux offres.
 */
export function titleKey(title: string, location: string | null, country: string | null): string {
  const place = new Set(tokenize(`${location ?? ""} ${country ?? ""}`));
  return tokenize(title.replace(/(^|[^\p{L}\d])(\d+)(?=$|[^\p{L}\d])/gu, "$1 n$2 "))
    .filter((t) => !place.has(t))
    .join(" ");
}

/** Même intitulé dans le même pays : les offres entre lesquelles chercher un même employeur. */
function postKey(o: DedupeInput): string | null {
  const title = titleKey(o.title, o.location, o.country);
  return title ? `${title}|${normalize(o.country ?? "")}` : null;
}

/** Deux publications de la même offre ? */
export function sameOffer(a: DedupeInput, b: DedupeInput): boolean {
  const key = postKey(a);
  return !!key && key === postKey(b) && sameCompany(a.company, b.company);
}

export type DedupeCandidate = DedupeInput & {
  /** Candidature, document ou avis sur cette offre. */
  activity: boolean;
  closed: boolean;
  description_status: "ok" | "partial" | "failed";
  score: number | null;
  posted_at: string | null;
};

const STATUS_RANK = { ok: 0, partial: 1, failed: 2 } as const;

/**
 * Celle qui représente le groupe dans la liste : celle sur laquelle l'utilisateur
 * a déjà agi (son avis, son dossier restent visibles), puis une offre en ligne,
 * la description la plus complète, la meilleure note, la plus récente.
 */
function compareRepresentative(a: DedupeCandidate, b: DedupeCandidate): number {
  return (
    Number(b.activity) - Number(a.activity) ||
    Number(a.closed) - Number(b.closed) ||
    STATUS_RANK[a.description_status] - STATUS_RANK[b.description_status] ||
    (b.score ?? 0) - (a.score ?? 0) ||
    (b.posted_at ?? "").localeCompare(a.posted_at ?? "") ||
    a.id - b.id
  );
}

/** Pour chaque offre doublon, l'id de l'offre qui représente son groupe. */
export function groupDuplicates(rows: DedupeCandidate[]): Map<number, number> {
  const byPost = new Map<string, DedupeCandidate[]>();
  for (const r of rows) {
    const key = companyKey(r.company) ? postKey(r) : null;
    if (key) (byPost.get(key) ?? byPost.set(key, []).get(key)!).push(r);
  }
  const representativeOf = new Map<number, number>();
  for (const posts of byPost.values()) {
    // Groupes d'un même employeur parmi les offres de même intitulé (union de proche en proche).
    const parent = posts.map((_, i) => i);
    const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    for (let i = 0; i < posts.length; i++) {
      for (let j = i + 1; j < posts.length; j++) {
        if (sameCompany(posts[i].company, posts[j].company)) parent[find(j)] = find(i);
      }
    }
    const groups = new Map<number, DedupeCandidate[]>();
    posts.forEach((p, i) => (groups.get(find(i)) ?? groups.set(find(i), []).get(find(i))!).push(p));
    for (const members of groups.values()) {
      if (members.length < 2) continue;
      const [rep, ...others] = [...members].sort(compareRepresentative);
      for (const o of others) representativeOf.set(o.id, rep.id);
    }
  }
  return representativeOf;
}
