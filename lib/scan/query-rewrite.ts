/**
 * Un poste visé tel que le CV l'écrit n'est pas une bonne requête. Mesuré sur
 * France Travail (audit d'octobre 2026, 8 CV neufs) : « Conductrice de travaux
 * principale » trouve 45 offres en France, « Conducteur de travaux principal »
 * 252 ; « Masseur-Kinésithérapeute Diplômée d'État » 8, « Masseur
 * kinésithérapeute » 2 228 ; « Développeur back-end PHP / Symfony » 9,
 * « Développeur PHP » plus de 150. Dans le Bas-Rhin, la première requête de la
 * conductrice ne rendait aucune offre.
 *
 * La réécriture garde le métier et retire ce qui rétrécit la recherche sans
 * rien dire du poste : marques de genre, forme féminine (les annonces sont
 * titrées au masculin, « H/F »), diplôme, grade, spécialité accolée par une
 * barre oblique. La note, elle, voit toujours le profil complet.
 */

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");

/** « Chargé(e) », « Conducteur·rice », « Développeur.se », « Technicien-ne », « (H/F) ». */
const GENDER_MARKS = [
  /\s*\(?\b[HF]\s*[/-]\s*[HF]\b\)?/g,
  /(?<=\p{L})(?:\(|·|\.|\/|-)(?:e|es|rice|trice|se|euse|ne|nne|ère|ière)\)?(?=[\s,]|$)/giu,
];

/** Diplôme ou titre accolé à l'intitulé : il qualifie la personne, pas le poste. */
const CREDENTIALS = /\s*\b(?:dipl[oô]m[ée]e?s?(?:\s+d['’]\s*[ée]tat)?|d\.\s?e\.?|certifi[ée]e?s?)(?=\s|$|,)/giu;
const TRAILING_DE = /\s+(?:DE|D\.E\.?)$/;

/** Grade : il qualifie la personne recherchée, la note s'en charge. */
const QUALIFIERS = new Set(
  ["principal", "principale", "senior", "sénior", "junior", "confirmé", "confirmée", "expérimenté", "expérimentée", "débutant", "débutante"].map(norm)
);

/**
 * Spécialité de développement : « Développeur back-end PHP » ne trouvait
 * qu'une offre dans le Finistère, « Développeur PHP » vingt. Retirée seulement
 * s'il reste de quoi préciser le poste (« Développeur full stack » reste tel quel).
 */
const STACK_WORDS = /\b(?:full|back|front)[\s-]?(?:stack|end)\b/gi;

/** Formes féminines courantes, où qu'elles soient dans l'intitulé. */
const FEMININE: Record<string, string> = {
  chargee: "chargé", assistante: "assistant", adjointe: "adjoint", ingenieure: "ingénieur", consultante: "consultant",
  agente: "agent", experte: "expert", commerciale: "commercial", cheffe: "chef", technicienne: "technicien",
  employee: "employé", deleguee: "délégué", attachee: "attaché", generale: "général", administrative: "administratif",
  sociale: "social", medicale: "médical", soignante: "soignant", enseignante: "enseignant", surveillante: "surveillant",
  principale: "principal", premiere: "premier",
};

/** Métiers que les annonces titrent au féminin : « Puéricultrice » 3 382 offres sur France Travail, « Puériculteur » 1 508. */
const KEEP_FEMININE = new Set(["puericultrice"]);

/**
 * Premier mot seulement : c'est le métier (« Conductrice de travaux »), et les
 * mots suivants peuvent finir pareil sans être féminins (« Responsable filière »).
 */
const HEAD_SUFFIXES: [RegExp, string][] = [
  [/trice$/, "teur"],
  [/euse$/, "eur"],
  [/ienne$/, "ien"],
  [/iere$/, "ier"],
  [/ere$/, "er"],
  [/ee$/, "é"],
];

function matchCase(source: string, target: string): string {
  return source[0] === source[0].toUpperCase() ? target[0].toUpperCase() + target.slice(1) : target;
}

/** « Conductrice » → « Conducteur » ; les mots inconnus restent tels quels. */
function masculine(word: string, head: boolean): string {
  // « Masseuse-kinésithérapeute », « Aide-soignante » : chaque partie compte.
  if (word.includes("-")) return word.split("-").map((w, i) => masculine(w, head && i === 0)).join("-");
  const k = norm(word);
  if (KEEP_FEMININE.has(k)) return word;
  if (FEMININE[k]) return matchCase(word, FEMININE[k]);
  if (!head || k.length < 6) return word;
  for (const [suffix, replacement] of HEAD_SUFFIXES) {
    if (suffix.test(k)) {
      // Le radical garde ses accents (« Infirmière » → « Infirmier ») : seule la fin change.
      const cut = k.match(suffix)![0].length;
      return word.slice(0, word.length - cut) + replacement;
    }
  }
  return word;
}

function clean(s: string): string {
  return s.replace(/\s+/g, " ").replace(/^[\s,;:–—-]+|[\s,;:–—-]+$/g, "").trim();
}

/**
 * Requêtes tirées d'un intitulé : l'intitulé réécrit, plus la partie droite
 * d'une barre oblique quand elle est elle-même un poste (« Comptable /
 * Assistant de gestion »). Une partie droite d'un mot (« / Symfony ») ou en
 * minuscules (« & social media ») précise le poste de gauche : elle tombe.
 */
export function rewriteTitle(title: string): string[] {
  let t = title;
  for (const re of GENDER_MARKS) t = t.replace(re, "");
  t = t.replace(/\([^)]*\)/g, " ");
  // Un intitulé anglais garde ses mots : « Employee » n'est pas « Employée ».
  const english = isEnglishTitle(t);
  // « & » seulement entre espaces : « R&D » est un mot.
  const [left, ...rest] = t.split(/\s*\/\s*|\s+&\s+|\s+\|\s+/);
  const parts = [left, ...rest.filter((r) => r.trim().split(/\s+/).length >= 2 && /^\p{Lu}/u.test(r.trim()))];
  const out: string[] = [];
  for (const part of parts) {
    const words = clean(part.replace(CREDENTIALS, " ").replace(TRAILING_DE, ""))
      .split(" ")
      .filter(Boolean)
      .map((w, i) => (english ? w : masculine(w, i === 0)))
      .filter((w) => !QUALIFIERS.has(norm(w)));
    let p = clean(words.join(" "));
    const narrower = clean(p.replace(STACK_WORDS, " "));
    if (narrower.split(" ").length >= 2) p = narrower;
    if (p) out.push(p);
  }
  return out.length ? out : [clean(title)];
}

// --- Intitulés anglais ---------------------------------------------------------

/** Mot de tête anglais → métier français. */
const EN_HEADS: Record<string, string> = {
  engineer: "Ingénieur", developer: "Développeur", technician: "Technicien", analyst: "Analyste",
  consultant: "Consultant", architect: "Architecte", buyer: "Acheteur", accountant: "Comptable",
  nurse: "Infirmier", teacher: "Enseignant", trainer: "Formateur", manager: "Responsable", director: "Directeur",
};

/** Intitulés figés, prioritaires sur la traduction mot à mot. */
const EN_PHRASES: Record<string, string> = {
  "project manager": "Chef de projet", "sales manager": "Responsable commercial", "sales representative": "Commercial",
  "account manager": "Chargé d'affaires", "registered nurse": "Infirmier", "software engineer": "Ingénieur logiciel",
  "software developer": "Développeur", "web developer": "Développeur web", "supply chain manager": "Responsable supply chain",
};

/** Qualificatifs anglais → français ; un mot absent arrête la traduction (sauf noms de technologies). */
const EN_MODIFIERS: Record<string, string> = {
  mechanical: "mécanique", design: "conception", software: "logiciel", electrical: "électrique", electronic: "électronique",
  electronics: "électronique", civil: "génie civil", process: "procédés", quality: "qualité", test: "essais",
  testing: "essais", validation: "validation", structural: "structure", stress: "calcul", manufacturing: "industrialisation",
  production: "production", maintenance: "maintenance", industrial: "industriel", project: "projet", systems: "systèmes",
  system: "systèmes", embedded: "embarqué", network: "réseau", web: "web", mobile: "mobile", marketing: "marketing",
  sales: "commercial", logistics: "logistique", purchasing: "achats", procurement: "achats", finance: "finance",
  financial: "financier", hr: "RH", data: "data", cloud: "cloud", devops: "DevOps",
  security: "sécurité", automation: "automatisme", rd: "R&D", product: "produit", operations: "opérations",
  fullstack: "full stack", backend: "back-end", frontend: "front-end",
};

/** Noms propres de technologies : gardés tels quels dans un intitulé de développeur. */
const TECH = /^(?:[A-Z][A-Za-z0-9+#.]*|[a-z]+\.js|\.net)$/;

/**
 * « Mechanical Design Engineer » → « Ingénieur conception mécanique ». Null
 * quand l'intitulé n'est pas reconnu comme anglais, ou qu'un de ses mots
 * n'est pas dans le glossaire : mieux vaut aucune traduction qu'une fausse.
 */
export function frenchTitle(title: string): string | null {
  if (/[àâçéèêëîïôûùüÿœ]/i.test(title)) return null;
  // « Full Stack » reste un seul qualificatif, sans quoi l'ordre inversé donnerait « Stack Full ».
  const words = title.replace(STACK_WORDS, (m) => m.replace(/[\s-]+/, "-")).replace(/[()]/g, " ").split(/\s+/).filter(Boolean)
    .filter((w) => !QUALIFIERS.has(norm(w)) && !/^(?:sr|jr|lead|chief|head)\.?$/i.test(w));
  if (!words.length) return null;
  const phrase = words.map(norm).join(" ");
  if (EN_PHRASES[phrase]) return EN_PHRASES[phrase];
  for (const [en, fr] of Object.entries(EN_PHRASES)) {
    if (phrase.endsWith(` ${en}`)) {
      const mods = translateModifiers(words.slice(0, words.length - en.split(" ").length), false);
      return mods === null ? null : `${fr} ${mods}`.trim();
    }
  }
  const head = EN_HEADS[norm(words[words.length - 1])];
  if (!head) return null;
  const mods = translateModifiers(words.slice(0, -1), head === "Développeur");
  return mods === null ? null : `${head} ${mods}`.trim();
}

/** Intitulé terminé par un métier anglais (« Design Engineer », « Marketing Manager »), sans accent. */
function isEnglishTitle(title: string): boolean {
  if (/[àâçéèêëîïôûùüÿœ]/i.test(title)) return false;
  const last = norm(title.trim().split(/\s+/).pop() ?? "");
  return last in EN_HEADS;
}

/** Qualificatifs dans l'ordre français (inverse de l'anglais) ; null si l'un est inconnu. */
function translateModifiers(words: string[], keepTech: boolean): string | null {
  const out: string[] = [];
  for (const w of [...words].reverse()) {
    const fr = EN_MODIFIERS[norm(w).replace(/[^a-z]/g, "")];
    if (fr) out.push(fr);
    else if (keepTech && TECH.test(w)) out.push(w);
    else return null;
  }
  return out.join(" ");
}
