// Score ATS du CV importé — local, déterministe, gratuit (même philosophie que
// lib/scoring/local.ts : aucun appel IA, instantané et illimité).
// Analyse le TEXTE extrait du fichier (PDF/DOCX/TXT/image OCR) sur les critères
// classiques de lisibilité par un ATS (Applicant Tracking System).

export type AtsCriterion = {
  /** Identifiant stable du critère. */
  id: string;
  /** Intitulé affiché à l'utilisateur. */
  label: string;
  /** Points obtenus (>= 0). */
  points: number;
  /** Points maximum du critère. */
  max: number;
  /** Vrai si le critère est rempli. */
  ok: boolean;
  /** Détail court affiché sous le critère (valeur trouvée ou manque). */
  detail: string;
};

export type AtsSuggestion = {
  /** Identifiant du critère visé. */
  criterion: string;
  /** Problème constaté, en une phrase. */
  issue: string;
  /** Action concrète pour gagner des points. */
  fix: string;
  /** Gain de score estimé si l'action est appliquée. */
  gain: number;
};

export type AtsScoreResult = {
  score: number;
  max: number;
  grade: "excellent" | "bon" | "moyen" | "faible";
  criteria: AtsCriterion[];
  suggestions: AtsSuggestion[];
};

const SECTION_PATTERNS: { id: string; label: string; re: RegExp }[] = [
  { id: "section_experience", label: "Section expériences", re: /exp[eé]rience|stage|emploi|career|internship|professionnel/i },
  { id: "section_education", label: "Section formation", re: /formation|[eé]ducation|dipl[oô]me|degree|etudes|[eé]tudes/i },
  { id: "section_skills", label: "Section compétences", re: /comp[eé]tences|skills|technologies|outils|tools|logiciels/i },
];

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;
const PHONE_RE = /(?:\+\d{1,3}[\s.-]?)?(?:\d[\s.-]?){8,14}\d/;
const LINKEDIN_RE = /linkedin\.com\/in\//i;
const BULLET_CHAR_RE = /^[•▪◦‣·●]\s*/;
// Dates lisibles : « janv. 2022 », « 01/2022 », « 2022-2023 », « Mars 2021 »...
const DATE_RE = /\b(?:\d{1,2}[\/.\-\s])?(?:(?:janv|f[eé]vr|mar|avr|mai|juin|juil|ao[uû]|sept|oct|nov|d[eé]c)[a-z.]*|jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec)[a-z.]*(?:\d{1,2}[\/.\-\s])?\s?\d{4}\b|\b(?:19|20)\d{2}\s?[-–]\s?(?:\d{2}\/)?(?:19|20)?\d{2}\b|\b(?:0?[1-9]|1[0-2])\/(?:19|20)\d{2}\b/i;
const ACTION_VERBS = [
  "d[eé]velopp", "con[uû]", "dirig", "g[eé]r", " pilot", "anim", "coordin", "optimis", "automatis",
  "concev", "impl[eé]ment", "analy", "n[eé]goci", "encadr", "form", "am[eé]lior", "cr[eé][eé]",
  "r[eé]alis", "supervis", "migr", "test", "d[eé]ploy", "int[eé]gr", "modernis", "structur",
  "developed", "designed", "led", "managed", "built", "created", "implemented", "improved",
  "analyzed", "coordinated", "optimized", "automated", "delivered", "launched", "reduced",
];

function normalize(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

export function scoreAts(text: string, targetTitle?: string | null): AtsScoreResult {
  const criteria: AtsCriterion[] = [];
  const suggestions: AtsSuggestion[] = [];
  const trimmed = text.trim();
  const lines = trimmed.split(/\n/).map((l) => l.trim()).filter(Boolean);
  const norm = normalize(trimmed);
  const wordCount = trimmed.split(/\s+/).filter(Boolean).length;

  const push = (
    id: string,
    label: string,
    ok: boolean,
    max: number,
    detail: string,
    fix: string
  ) => {
    const points = ok ? max : 0;
    criteria.push({ id, label, points, max, ok, detail });
    if (!ok) suggestions.push({ criterion: id, issue: detail, fix, gain: max });
  };

  // 1. Coordonnées (12 pts) — un ATS doit pouvoir t'identifier et te recontacter.
  const hasEmail = EMAIL_RE.test(trimmed);
  const hasPhone = PHONE_RE.test(trimmed.replace(/\s/g, "").length > 0 ? trimmed : "");
  push(
    "contact_email",
    "Adresse e-mail",
    hasEmail,
    6,
    hasEmail ? "E-mail détecté" : "Aucune adresse e-mail trouvée",
    "Ajoute une adresse e-mail professionnelle en haut du CV (ex. prenom.nom@email.com)."
  );
  push(
    "contact_phone",
    "Numéro de téléphone",
    hasPhone,
    6,
    hasPhone ? "Téléphone détecté" : "Aucun numéro de téléphone trouvé",
    "Ajoute ton numéro de téléphone avec l'indicatif international si tu vises l'étranger (ex. +33 6 12 34 56 78)."
  );

  // 2. Sections attendues (18 pts) — structure que les ATS cherchent.
  for (const s of SECTION_PATTERNS) {
    push(
      s.id,
      s.label,
      s.re.test(trimmed),
      6,
      s.re.test(trimmed) ? "Section détectée" : "Section absente ou intitulée autrement",
      `Intitule une section « ${s.label} » : les ATS cherchent ces titres exacts.`
    );
  }

  // 3. Dates lisibles (12 pts) — machines et humains.
  const dateMatches = trimmed.match(new RegExp(DATE_RE.source, "gi")) ?? [];
  const datesOk = dateMatches.length >= 2;
  push(
    "dates",
    "Dates lisibles",
    datesOk,
    12,
    datesOk ? `${dateMatches.length} dates détectées` : "Moins de 2 dates lisibles",
    "Écris les dates dans un format simple et constant (ex. « Janv. 2022 – Mars 2024 » ou « 01/2022 – 03/2024 »)."
  );

  // 4. Longueur (10 pts) — 1 à 2 pages attendues.
  const lengthOk = wordCount >= 200 && wordCount <= 900;
  push(
    "length",
    "Longueur du CV",
    lengthOk,
    10,
    `${wordCount} mots ${wordCount < 200 ? "(trop court)" : wordCount > 900 ? "(trop long)" : "(1-2 pages)"}`,
    "Vise 200 à 900 mots (1 à 2 pages) : un ATS comme un recruteur décroche au-delà."
  );

  // 5. Densité de mots-clés vs le titre visé (20 pts) — critère n°1 des ATS.
  if (targetTitle && targetTitle.trim()) {
    const titleTokens = normalize(targetTitle)
      .split(/[^a-z0-9+#]+/)
      .filter((t) => t.length >= 3 && !["pour", "and", "the"].includes(t));
    const unique = [...new Set(titleTokens)];
    const matched = unique.filter((t) => norm.includes(t));
    const ratio = unique.length ? matched.length / unique.length : 0;
    const kwOk = matched.length >= Math.max(1, Math.ceil(unique.length * 0.6));
    push(
      "keywords",
      "Mots-clés du poste visé",
      kwOk,
      20,
      matched.length === 0
        ? `Aucun mot-clé de « ${targetTitle} » trouvé`
        : `${matched.length}/${unique.length} mots-clés trouvés`,
      `Reprends naturellement le vocabulaire du poste (« ${targetTitle} ») dans ton résumé et tes expériences.`
    );
  } else {
    // Sans titre visé : critère neutre, non compté (transparence du barème).
    criteria.push({
      id: "keywords",
      label: "Mots-clés du poste visé",
      points: 0,
      max: 0,
      ok: false,
      detail: "Indique un intitulé de poste pour activer ce critère",
    });
  }

  // 6. Puces d'expérience (12 pts) — format que les ATS parsent bien.
  const bulletLines = lines.filter((l) => BULLET_CHAR_RE.test(l)).length;
  const bulletsOk = bulletLines >= 3;
  push(
    "bullets",
    "Puces dans les expériences",
    bulletsOk,
    12,
    bulletsOk ? `${bulletLines} puces détectées` : "Expériences en prose, pas en puces",
    "Transforme tes missions en puces courtes (3-5 par expérience) : ATS et recruteurs les lisent mieux."
  );

  // 7. Verbes d'action (8 pts).
  const verbCount = ACTION_VERBS.filter((v) => new RegExp(v).test(norm)).length;
  const verbsOk = verbCount >= 3;
  push(
    "action_verbs",
    "Verbes d'action",
    verbsOk,
    8,
    verbsOk ? `${verbCount} verbes d'action trouvés` : "Trop peu de verbes d'action",
    "Commence tes puces par des verbes d'action (développé, piloté, conçu, optimisé...)."
  );

  // 8. LinkedIn (4 pts).
  const hasLinkedin = LINKEDIN_RE.test(trimmed);
  push(
    "linkedin",
    "Lien LinkedIn",
    hasLinkedin,
    4,
    hasLinkedin ? "Lien détecté" : "Aucun lien LinkedIn",
    "Ajoute l'URL de ton profil LinkedIn (linkedin.com/in/...) avec tes coordonnées."
  );

  // 9. Mots pleins / artéfacts de mise en page (14 pts) — un CV-image
  // ou truffé de caractères spéciaux est mal parsé par les ATS.
  const letters = trimmed.replace(/[^a-zA-ZÀ-ÿ]/g, "").length;
  const gibberishRatio = wordCount > 0 ? 1 - letters / Math.max(1, trimmed.replace(/\s/g, "").length) : 1;
  const parseOk = wordCount >= 50 && gibberishRatio < 0.6;
  push(
    "parseable",
    "Texte extractible",
    parseOk,
    14,
    parseOk
      ? "Le texte est bien extractible"
      : wordCount < 50
        ? "Très peu de texte extrait (PDF scanné ?)"
        : "Beaucoup de caractères non textuels (colonnes, tableaux, image)",
    "Utilise un PDF textuel (pas un scan ni une image) et évite tableaux, colonnes et en-têtes/pieds de page."
  );

  const max = criteria.reduce((acc, c) => acc + c.max, 0);
  const score = criteria.reduce((acc, c) => acc + c.points, 0);
  const pct = max > 0 ? score / max : 0;
  const grade: AtsScoreResult["grade"] =
    pct >= 0.85 ? "excellent" : pct >= 0.65 ? "bon" : pct >= 0.4 ? "moyen" : "faible";

  return {
    score,
    max,
    grade,
    criteria,
    suggestions: suggestions.sort((a, b) => b.gain - a.gain),
  };
}
