import type { ProfileFull } from "@/lib/cv/types";

/**
 * Langue : un critère ÉLIMINATOIRE, pas un bonus. Une annonce rédigée dans une
 * langue que la personne ne parle pas, ou qui en exige une, est hors critères
 * quelle que soit la proximité de son intitulé. Additionner la langue aux
 * autres critères laissait « Sales Development Representative – German
 * Speaking » à 52 pour un profil sans un mot d'allemand.
 *
 * Deux lectures distinctes :
 * - la langue de RÉDACTION, déduite des mots-outils propres à chaque langue ;
 * - les langues EXIGÉES, cherchées dans le titre et dans des tournures
 *   d'exigence (« German speaking », « maîtrise de l'allemand », « Deutschkenntnisse »),
 *   sauf quand l'annonce les donne pour un atout.
 */

export type Mastery = "mastered" | "partial";

type LangInfo = {
  label: string;
  /** Noms de la langue en français, anglais, allemand, espagnol, italien (sans accents). */
  names: string[];
  adjectives?: string[];
  /** Mots-outils propres à la langue, pour reconnaître la langue de rédaction. */
  markers?: string[];
};

const LANGS: Record<string, LangInfo> = {
  fr: {
    label: "le français",
    names: ["francais", "french", "franzosisch", "frances", "francese"],
    adjectives: ["francophone"],
    markers: ["les", "des", "et", "pour", "avec", "vous", "votre", "vos", "nous", "notre", "une", "est", "sont", "dans", "sur", "aux", "qui", "cette", "poste", "entreprise", "equipe"],
  },
  en: {
    label: "l'anglais",
    names: ["anglais", "english", "englisch", "ingles", "inglese"],
    adjectives: ["anglophone"],
    markers: ["the", "and", "of", "for", "with", "you", "your", "we", "our", "will", "are", "this", "that", "team", "role", "skills", "who", "what", "have"],
  },
  de: {
    label: "l'allemand",
    names: ["allemand", "german", "deutsch", "aleman", "tedesco"],
    adjectives: ["germanophone"],
    markers: ["der", "die", "das", "und", "mit", "fur", "sie", "wir", "ihre", "unsere", "eine", "einen", "ist", "sind", "auf", "bei", "oder", "auch", "nicht", "diese", "dich", "dein", "deine", "erfahrung", "aufgaben", "kenntnisse", "sowie"],
  },
  nl: {
    label: "le néerlandais",
    names: ["neerlandais", "dutch", "nederlands", "flamand", "flemish", "vlaams", "niederlandisch"],
    adjectives: ["neerlandophone"],
    markers: ["het", "een", "van", "voor", "met", "jouw", "jij", "wij", "onze", "zijn", "bij", "ook", "naar", "niet", "deze", "bent", "heeft", "ervaring", "functie", "werken", "vacature"],
  },
  es: {
    label: "l'espagnol",
    names: ["espagnol", "spanish", "espanol", "castellano", "spanisch", "spagnolo"],
    adjectives: ["hispanophone"],
    markers: ["el", "los", "las", "y", "del", "para", "con", "una", "por", "su", "sus", "nuestro", "nuestra", "experiencia", "empresa", "equipo", "trabajo", "como"],
  },
  it: {
    label: "l'italien",
    names: ["italien", "italian", "italiano", "italienisch"],
    adjectives: ["italophone"],
    markers: ["gli", "della", "delle", "degli", "per", "sono", "esperienza", "azienda", "lavoro", "nostro", "nostra", "che", "di", "nel", "alla"],
  },
  pt: {
    label: "le portugais",
    names: ["portugais", "portuguese", "portugues", "portugiesisch", "portoghese"],
    adjectives: ["lusophone"],
    markers: ["os", "das", "dos", "com", "uma", "sao", "voce", "nao", "em", "na", "trabalho", "nosso", "nossa", "equipe"],
  },
  ar: { label: "l'arabe", names: ["arabe", "arabic", "arabisch", "arabo"], adjectives: ["arabophone"] },
  zh: { label: "le chinois", names: ["chinois", "chinese", "mandarin", "cantonais", "cantonese"] },
  ja: { label: "le japonais", names: ["japonais", "japanese"] },
  ru: { label: "le russe", names: ["russe", "russian"] },
  pl: { label: "le polonais", names: ["polonais", "polish"] },
  tr: { label: "le turc", names: ["turc", "turkish"] },
  wo: { label: "le wolof", names: ["wolof"] },
  lb: { label: "le luxembourgeois", names: ["luxembourgeois", "luxembourgish", "letzebuergesch"] },
};

function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/ß/g, "ss")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

// ---------------------------------------------------------------------------
// Ce que le profil parle
// ---------------------------------------------------------------------------

const PROFICIENT = /\b(c1|c2|b2|courant|courante|fluent|bilingue|bilingual|natif|native|maternelle|mother|avance|advanced|professionnel|professional)\b/;
const PARTIAL = /\b(a1|a2|b1|notions?|scolaire|basique|basic|beginner|debutant|intermediaire|intermediate|elementaire|elementary)\b/;

function isoOfName(name: string): string | null {
  const n = norm(name);
  for (const [iso, info] of Object.entries(LANGS)) {
    if (info.names.some((x) => n.includes(x))) return iso;
  }
  return null;
}

/** Langue dominante d'un texte, ou null s'il est trop court pour trancher. */
export function detectLanguage(text: string): { lang: string | null; counts: Record<string, number> } {
  const counts: Record<string, number> = {};
  const sets = Object.entries(LANGS)
    .filter(([, i]) => i.markers)
    .map(([iso, i]) => [iso, new Set(i.markers)] as const);
  for (const w of norm(text).split(/[^a-z]+/)) {
    if (!w) continue;
    for (const [iso, set] of sets) if (set.has(w)) counts[iso] = (counts[iso] ?? 0) + 1;
  }
  let lang: string | null = null;
  for (const [iso, c] of Object.entries(counts)) if (!lang || c > counts[lang]) lang = iso;
  if (!lang || counts[lang] < 8) return { lang: null, counts };
  return { lang, counts };
}

/**
 * Langues du profil, avec leur niveau. La langue dans laquelle le CV est écrit
 * compte comme maîtrisée même si la liste l'omet — beaucoup de CV français ne
 * mentionnent pas le français. Liste vide : null, on ne filtre rien.
 */
export function profileLanguages(profile: ProfileFull): Map<string, Mastery> | null {
  if (!profile.languages.length) return null;
  const out = new Map<string, Mastery>();
  for (const l of profile.languages) {
    const iso = isoOfName(l.name ?? "");
    if (!iso) continue;
    const level = norm(l.level ?? "");
    // Listée sans niveau : on considère qu'elle est parlée.
    const mastery: Mastery = !level || PROFICIENT.test(level) || !PARTIAL.test(level) ? "mastered" : "partial";
    if (out.get(iso) !== "mastered") out.set(iso, mastery);
  }
  const cvText =
    profile.raw_cv_text ||
    [profile.summary ?? "", ...profile.experiences.flatMap((e) => [e.title, e.description ?? "", ...e.bullet_points])].join("\n");
  const cvLang = detectLanguage(cvText).lang;
  if (cvLang) out.set(cvLang, "mastered");
  return out;
}

// ---------------------------------------------------------------------------
// Ce que l'annonce exige
// ---------------------------------------------------------------------------

const OPTIONAL_AFTER = /^.{0,60}?(un plus|un atout|is a plus|a plus\b|an advantage|advantageous|nice to have|bonus|apprecie|souhaite|de preference|ideally|idealement|serait|would be|preferred|preferable|wunschenswert|von vorteil)/;
const OPTIONAL_BEFORE = /(atouts?|nice to have|bonus|un plus|a plus|apprecie|souhaite|optionnel|optional|wunschenswert)\W[^.;\n]{0,40}$/;

function requirementPatterns(n: string, adj: string): RegExp[] {
  const L = `(?:${n})`;
  const pats = [
    // Anglais
    String.raw`\b(?:fluent|fluency|proficient|proficiency|native|business[- ]level|excellent|strong|good|professional|working)\s+(?:in\s+|command\s+of\s+|knowledge\s+of\s+)?(?:written\s+and\s+(?:spoken|oral)\s+)?${L}\b`,
    String.raw`\b${L}\s+(?:speaking|speaker|is\s+(?:required|mandatory|essential|a\s+must)|required|mandatory|essential|language\s+(?:skills\s+)?(?:required|is\s+required)|\((?:c1|c2|b2|native|fluent)\))`,
    String.raw`\b(?:speak|speaks)\s+(?:fluent\s+)?${L}\b`,
    // Français
    String.raw`\b(?:maitrise|maitriser|maitrisez|maitrisant|pratique|connaissance)\s+(?:courante\s+|parfaite\s+|excellente\s+|imperative\s+|indispensable\s+)?(?:de\s+l'\s*|de\s+l\s+|du\s+|de\s+la\s+|de\s+|d'\s*|l'\s*)?${L}\b`,
    String.raw`\b${L}\s+(?:courant|courante|exige|exigee|obligatoire|indispensable|requis|requise|imperatif|imperative|lu|ecrit|parle|niveau\s+(?:c1|c2|b2)|\((?:c1|c2|b2|courant)\))`,
    String.raw`\b(?:parlant|parlez|parler)\s+(?:couramment\s+)?(?:l'\s*)?${L}\b`,
    String.raw`\bbilingue\s+(?:\w+\s*(?:[/-]|et)\s*)?${L}\b`,
    // Allemand
    String.raw`\b(?:sehr\s+gute|gute|fliessende|fliessend|verhandlungssichere?|exzellente)\s+${L}(?:kenntnisse)?\b`,
    String.raw`\b${L}kenntnisse\b`,
    String.raw`\b${L}\s+(?:c1|c2|b2|fliessend|verhandlungssicher|muttersprache)`,
  ];
  if (adj) pats.push(String.raw`\b(?:${adj})s?\b`);
  return pats.map((p) => new RegExp(p, "g"));
}

const PATTERNS = Object.fromEntries(
  Object.entries(LANGS).map(([iso, i]) => [iso, requirementPatterns(i.names.join("|"), (i.adjectives ?? []).join("|"))])
);

/** Langues exigées : citées dans le titre, ou dans une tournure d'exigence qui n'est pas un « plus ». */
export function requiredLanguages(title: string, description: string): string[] {
  const t = norm(title);
  const d = norm(description).replace(/\s+/g, " ");
  const out = new Set<string>();
  // « Bilingue anglais », dans une annonce française : français ET anglais.
  if (/\bbilingue\s+(?:en\s+)?(?:anglais|allemand|espagnol|italien|neerlandais|portugais|chinois|arabe)\b/.test(`${t} ${d}`)) out.add("fr");
  for (const [iso, info] of Object.entries(LANGS)) {
    // Un titre ne cite une langue que lorsqu'il l'exige (« German Speaking », « (Portuguese Language) »).
    if (info.names.some((n) => new RegExp(String.raw`\b${n}\b`).test(t))) {
      out.add(iso);
      continue;
    }
    for (const re of PATTERNS[iso]) {
      re.lastIndex = 0;
      for (const m of d.matchAll(re)) {
        const at = m.index ?? 0;
        const before = d.slice(Math.max(0, at - 60), at);
        const after = d.slice(at + m[0].length, at + m[0].length + 80);
        if (OPTIONAL_AFTER.test(after) || OPTIONAL_BEFORE.test(before)) continue;
        out.add(iso);
        break;
      }
      if (out.has(iso)) break;
    }
  }
  return [...out];
}

const REQUIREMENTS_HEADER =
  /(?:profil recherche|votre profil|le profil|profil souhaite|ce que nous recherchons|qui etes vous|ce qu on attend de vous|vos atouts|competences requises|vous etes|requirements|your profile|about you|who you are|what you(?:'|’)ll bring|what we(?:'|’)re looking for|qualifications)/;

/** Le bloc des exigences (« Profil recherché », « Requirements »…), s'il est assez long pour dire sa langue. */
function requirementSection(description: string): string | null {
  // Ponctuation en espaces : « Qui êtes-vous ? » doit se lire « qui etes vous ».
  const d = norm(description).replace(/[^a-z0-9'’]+/g, " ");
  const at = d.search(REQUIREMENTS_HEADER);
  if (at < 0) return null;
  const section = d.slice(at, at + 1200);
  return section.length >= 200 ? section : null;
}

// ---------------------------------------------------------------------------
// Verdict
// ---------------------------------------------------------------------------

export type LanguageAssessment = {
  /** 0–100, pour l'affichage. */
  score: number;
  /** Multiplicateur de la note (niveau partiel). */
  factor: number;
  excluded: string | null;
  note: string | null;
  offerLang: string | null;
};

export function assessLanguage(
  spoken: Map<string, Mastery> | null,
  title: string,
  description: string
): LanguageAssessment {
  const { lang, counts } = detectLanguage(`${title}\n${description}`);
  if (!spoken) return { score: 70, factor: 1, excluded: null, note: null, offerLang: lang };

  const label = (iso: string) => LANGS[iso]?.label ?? iso;
  let factor = 1;
  const notes: string[] = [];

  // 1. Langue de rédaction. Une annonce bilingue passe si l'une de ses langues
  //    est maîtrisée et y occupe une vraie place (35 % de la langue dominante).
  if (lang && spoken.get(lang) !== "mastered") {
    const bilingual = Object.entries(counts).some(
      ([iso, c]) => iso !== lang && spoken.get(iso) === "mastered" && c >= 6 && c >= 0.35 * counts[lang]
    );
    if (!bilingual) {
      if (spoken.get(lang) === "partial") {
        factor *= 0.6;
        notes.push(`annonce rédigée en ${label(lang).replace(/^(le |l')/, "")}, niveau partiel au profil`);
      } else {
        const reason = `annonce rédigée en ${label(lang).replace(/^(le |l')/, "")}, langue absente du profil`;
        return { score: 0, factor: 1, excluded: reason, note: reason, offerLang: lang };
      }
    }
  }

  // 2. Langue du « profil recherché ». Le reste d'une annonce peut être dans une
  //    autre langue sans rien dire du poste : présentation du groupe en anglais
  //    puis exigences en français (Essity), résumé rédigé par le site d'emploi
  //    (Welcome to the Jungle résume en anglais des annonces françaises, et
  //    inversement). Ce sont les exigences qui disent la langue de travail.
  const requirements = requirementSection(description);
  if (requirements) {
    const req = detectLanguage(requirements).lang;
    // Même langue que l'annonce à niveau partiel : déjà pénalisée plus haut.
    const alreadyPenalized = !!req && req === lang && spoken.get(req) === "partial";
    if (req && !alreadyPenalized && spoken.get(req) !== "mastered") {
      if (spoken.get(req) === "partial") {
        factor *= 0.6;
        notes.push(`profil recherché rédigé en ${label(req).replace(/^(le |l')/, "")}, niveau partiel au profil`);
      } else {
        const reason = `profil recherché rédigé en ${label(req).replace(/^(le |l')/, "")}, langue absente du profil`;
        return { score: 0, factor: 1, excluded: reason, note: reason, offerLang: lang };
      }
    }
  }

  // 3. Langues exigées.
  for (const iso of requiredLanguages(title, description)) {
    const m = spoken.get(iso);
    if (m === "mastered") continue;
    if (m === "partial") {
      factor *= 0.7;
      notes.push(`${label(iso)} demandé, niveau partiel au profil`);
      continue;
    }
    const reason = `l'annonce exige ${label(iso)}, absent du profil`;
    return { score: 0, factor: 1, excluded: reason, note: reason, offerLang: lang };
  }

  return {
    score: factor < 1 ? 50 : 100,
    factor,
    excluded: null,
    note: notes.length ? notes.join(" · ") : lang ? `langue ${lang.toUpperCase()} OK` : null,
    offerLang: lang,
  };
}
