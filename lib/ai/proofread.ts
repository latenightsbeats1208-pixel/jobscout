import "server-only";
import { getClaude, MODELS } from "./client";
import type { GeneratedCV } from "./generate-cv";
import type { GeneratedLM } from "./generate-lm";
import type { ProfileFull } from "@/lib/cv/types";
import { profileFacts } from "./profile-facts";
import { looksFrench, type DocLang } from "@/lib/text/lang";

/**
 * Passe de RELECTURE après génération (Sonnet, ~1-2 centimes par dossier) :
 * orthographe, grammaire, accords, typographie, style nominal des puces, et
 * suppression des affirmations que le profil n'étaye pas.
 *
 * Document en anglais (offre anglophone) : relecteur anglophone, qui traduit
 * aussi tout fragment français résiduel ; puis un garde-fou déterministe
 * (`looksFrench`) renvoie à la traduction les textes encore français, et les
 * champs courts (intitulés, diplômes, compétences, langues) sont traduits en
 * bloc — ils n'étaient relus par personne.
 *
 * Contrat de sécurité : la relecture ne doit JAMAIS faire échouer une
 * génération. En cas d'erreur, de réponse hors format ou de nombre d'éléments
 * différent, on renvoie les textes d'origine et on journalise.
 */

const SYSTEM_FR = `Tu es correcteur professionnel francophone pour des documents de candidature (CV et lettre de motivation). Tu reçois une liste de textes générés et les FAITS du profil du candidat. Corrige chaque texte, dans cet ordre de priorité :

1. Orthographe, grammaire, accords en genre et en nombre (« Mon maîtrise » → « Ma maîtrise »), conjugaison, ponctuation et typographie française (espace insécable avant : ; ! ?, guillemets « », majuscules accentuées « É »). Zéro faute tolérée.
2. Supprime ou neutralise toute affirmation NON étayée par les faits : activité, responsabilité, outil, chiffre ou résultat qui n'y figurent pas (ex. « négociation de contrats », « gestion de budget », « rédaction de cahiers des charges », « programme de fidélité » si absents des faits). Reformule sans l'affirmation ; si toute la phrase est invérifiable, supprime-la. Une reformulation fidèle d'un fait existant est acceptable. Ne sont PAS des affirmations à vérifier — conserve-les telles quelles : disponibilité pour un entretien, mobilité ou déménagement vers le lieu de l'offre, motivation et ce que le candidat apportera (intentions du candidat, pas des faits). Langues : noms et niveaux exactement ceux des faits, sans niveau ajouté.
3. Puces de CV (textes commençant par un verbe) : style nominal ou participe passé (« Pilotage de… », « Piloté… », « Animation de… ») — jamais un verbe conjugué à la première personne (« Pilote », « Conçois », « Construis », « Anime » en tête de puce sont proscrits).
4. Chronologie : les connecteurs temporels (« auparavant », « plus tôt », « précédemment », « ensuite », « en parallèle ») doivent être cohérents avec les dates des faits — corrige le connecteur s'il contredit l'ordre réel des expériences.
5. Ne change RIEN d'autre : pas de réécriture stylistique, pas d'ajout, pas de réordonnancement, longueur conservée à ±10 %. Conserve les noms propres, dates, chiffres et intitulés présents dans les faits.

Renvoie EXACTEMENT le même nombre de textes, dans le même ordre, via l'outil, avec la liste courte des corrections effectuées (vide si rien à corriger).`;

const SYSTEM_EN = `You are a professional English-language proofreader for job application documents (résumé and cover letter) addressed to an English-speaking employer. You receive a list of generated texts and the candidate's profile FACTS (the facts are written in French). Correct each text, in this order of priority:

1. Language: every text must be ENTIRELY in English. Translate any remaining French word, phrase, job title or degree into natural professional English. Keep proper nouns verbatim (company, school, brand, product and project names), as well as certifications and scores (TOEIC 925), CEFR levels (C2), dates and figures. Consistent US spelling. No French typography: no space before ":" ";" "!" "?", no « » quotation marks.
2. Spelling, grammar, punctuation and capitalization. Zero tolerance.
3. Remove or neutralize any claim NOT supported by the facts: an activity, responsibility, tool, figure or result that does not appear in them. Rephrase without the claim; if the whole sentence is unverifiable, delete it. A faithful rewording of an existing fact is acceptable. NOT claims to verify — keep them as they are: availability for an interview, willingness to relocate or travel to the job location, motivation and what the candidate will bring (intentions, not facts). Languages: names and levels exactly as in the facts, no added level. Platform vocabulary: "followers" on TikTok/Instagram, "subscribers" on YouTube. Fix French calques: "animate a community" → "run/engage a community", "animate social media" → "manage/run social media", "animate workshops" → "facilitate/lead workshops", "formation" → "degree/training", "realize" → "carry out", "actual" → "current", "editorialization" → "editorial planning".
4. Résumé bullets (texts starting with an action): past-tense action verb or noun phrase ("Managed…", "Coordination of…"); never first person ("I managed"), no trailing period.
5. Chronology: time connectors ("earlier", "previously", "then", "in parallel", "since") must be consistent with the dates in the facts — fix the connector when it contradicts the real order of the experiences.
6. Change NOTHING else: no stylistic rewrite, no additions, no reordering, length within ±10%. Keep the proper nouns, dates, figures and titles present in the facts.

Return EXACTLY the same number of texts, in the same order, via the tool, with a short list of the corrections made (empty if nothing to correct).`;

const TOOL = {
  name: "return_corrections",
  description: "Textes relus, dans le même ordre et le même nombre que l'entrée.",
  input_schema: {
    type: "object",
    properties: {
      items: { type: "array", items: { type: "string" } },
      changes: { type: "array", items: { type: "string" } },
    },
    required: ["items", "changes"],
  },
} as const;

const TRANSLATE_SYSTEM = `You translate fragments of a French résumé or cover letter into professional English for an English-speaking employer. You receive a numbered list of short items (job titles, degrees, skills, language names and levels, bullets, sentences). Return EXACTLY the same number of items, in the same order, via the tool.

Rules:
- Keep proper nouns verbatim: company, school, brand, product, platform and project names (e.g. Adobe Premiere Pro, TikTok, École Polytechnique, or the candidate's own project name). Keep certifications and scores (TOEIC 925), CEFR levels (C2), dates and figures.
- Job titles: idiomatic English equivalents ("Chargé de Communication Digitale" → "Digital Communications Officer").
- Degrees: translate, and keep the official French title in parentheses when it is a recognized designation ("Mastère Spécialisé — Conseil et Management des SI" → "Advanced Master's degree (Mastère Spécialisé) in IS Consulting and Management").
- Language names: French, English, Spanish… Levels: Native, Fluent, Professional, Intermediate (keep CEFR codes).
- Bullets stay in past-participle or noun-phrase style, without trailing period. Ongoing dates: "Present".
- If an item is already in English, return it unchanged. No additions, no explanations.`;

const TRANSLATE_TOOL = {
  name: "return_translations",
  description: "Items translated into English, same order and same count as the input.",
  input_schema: {
    type: "object",
    properties: { items: { type: "array", items: { type: "string" } } },
    required: ["items"],
  },
} as const;

export async function proofreadTexts(
  texts: string[],
  profile: ProfileFull,
  kind: "cv" | "lm",
  lang: DocLang = "fr"
): Promise<string[]> {
  const nonEmpty = texts.some((t) => t && t.trim());
  if (!nonEmpty) return texts;
  try {
    const client = getClaude();
    const message = await client.messages.create({
      model: MODELS.sonnet,
      max_tokens: 6000,
      system: [{ type: "text", text: lang === "en" ? SYSTEM_EN : SYSTEM_FR, cache_control: { type: "ephemeral" } }],
      tools: [TOOL as any],
      tool_choice: { type: "tool", name: "return_corrections" },
      messages: [
        {
          role: "user",
          content:
            lang === "en"
              ? `## Profile facts (source of truth, in French)\n${profileFacts(profile)}\n\n` +
                `## Document type: ${kind === "cv" ? "résumé (summary, then bullets)" : "cover letter (subject line, then paragraphs)"}\n\n` +
                `## Texts to proofread (${texts.length}) — output language: ENGLISH\n` +
                texts.map((t, i) => `[${i + 1}] ${t}`).join("\n\n")
              : `## Faits du profil (vérité de référence)\n${profileFacts(profile)}\n\n` +
                `## Type de document : ${kind === "cv" ? "CV (résumé puis puces)" : "lettre de motivation (objet puis paragraphes)"}\n\n` +
                `## Textes à relire (${texts.length})\n` +
                texts.map((t, i) => `[${i + 1}] ${t}`).join("\n\n"),
        },
      ],
    });
    const t = message.content.find((b) => b.type === "tool_use");
    if (!t || t.type !== "tool_use") throw new Error("pas de sortie d'outil");
    const out = (t.input as { items?: unknown; changes?: unknown }) ?? {};
    const items = Array.isArray(out.items) ? out.items : [];
    if (items.length !== texts.length || !items.every((x) => typeof x === "string")) {
      throw new Error(`nombre d'éléments inattendu (${items.length} ≠ ${texts.length})`);
    }
    const changes = Array.isArray(out.changes) ? out.changes.filter((c) => typeof c === "string") : [];
    if (changes.length) {
      console.log(`[proofread:${kind}:${lang}] ${changes.length} correction(s) :`);
      for (const c of changes.slice(0, 20)) console.log(`  • ${c}`);
    }
    // Un texte vidé par la relecture (phrase invérifiable) reste vide : on le filtre en aval.
    return items.map((x, i) => (typeof x === "string" ? x.trim() : texts[i]));
  } catch (e) {
    console.warn(`[proofread:${kind}] relecture ignorée :`, e instanceof Error ? e.message : e);
    return texts;
  }
}

/**
 * Traduit en anglais une liste de textes (Sonnet). Jamais bloquant : en cas
 * d'erreur ou de nombre d'éléments différent, les textes d'origine sont rendus.
 */
export async function translateToEnglish(items: string[], kind: string): Promise<string[]> {
  const idx = items.map((s, i) => (s && s.trim() ? i : -1)).filter((i) => i >= 0);
  if (!idx.length) return items;
  try {
    const client = getClaude();
    const message = await client.messages.create({
      model: MODELS.sonnet,
      max_tokens: 6000,
      system: [{ type: "text", text: TRANSLATE_SYSTEM, cache_control: { type: "ephemeral" } }],
      tools: [TRANSLATE_TOOL as any],
      tool_choice: { type: "tool", name: "return_translations" },
      messages: [
        {
          role: "user",
          content:
            `## Items to translate into English (${idx.length})\n` +
            idx.map((i, k) => `[${k + 1}] ${items[i]}`).join("\n"),
        },
      ],
    });
    const t = message.content.find((b) => b.type === "tool_use");
    if (!t || t.type !== "tool_use") throw new Error("pas de sortie d'outil");
    const out = (t.input as { items?: unknown }) ?? {};
    const got = Array.isArray(out.items) ? out.items : [];
    if (got.length !== idx.length || !got.every((x) => typeof x === "string")) {
      throw new Error(`nombre d'éléments inattendu (${got.length} ≠ ${idx.length})`);
    }
    const result = [...items];
    idx.forEach((i, k) => {
      const v = (got[k] as string).trim();
      if (v) result[i] = v;
    });
    const changed = idx.filter((i) => result[i] !== items[i]).length;
    console.log(`[translate:${kind}] ${changed}/${idx.length} élément(s) traduit(s) en anglais`);
    return result;
  } catch (e) {
    console.warn(`[translate:${kind}] traduction ignorée :`, e instanceof Error ? e.message : e);
    return items;
  }
}

/** Garde-fou : renvoie à la traduction les textes longs encore français après relecture. */
async function ensureEnglish(texts: string[], kind: string): Promise<string[]> {
  const flagged = texts.map((t, i) => (looksFrench(t) ? i : -1)).filter((i) => i >= 0);
  if (!flagged.length) return texts;
  console.log(`[translate:${kind}] ${flagged.length} texte(s) encore en français après relecture`);
  const translated = await translateToEnglish(flagged.map((i) => texts[i]), kind);
  const result = [...texts];
  flagged.forEach((i, k) => {
    result[i] = translated[k];
  });
  return result;
}

/** Relit résumé, puces d'expériences, de projets et de formations. */
export async function proofreadCV(cv: GeneratedCV, profile: ProfileFull, lang: DocLang = "fr"): Promise<GeneratedCV> {
  const texts: string[] = [cv.summary ?? ""];
  // Construit une liste plate + les remises en place correspondantes.
  const expBullets = cv.sections.experiences.map((e) => [...(e.bullet_points ?? [])]);
  const projBullets = (cv.sections.projects ?? []).map((p) => [...(p.bullet_points ?? [])]);
  const eduBullets = cv.sections.educations.map((e) => [...(e.bullet_points ?? [])]);
  const push = (arr: string[][]) => arr.forEach((bs) => bs.forEach((b) => texts.push(b)));
  push(expBullets); push(projBullets); push(eduBullets);

  let fixed = await proofreadTexts(texts, profile, "cv", lang);
  if (lang === "en") fixed = await ensureEnglish(fixed, "cv");
  // Un texte vidé par la relecture l'a été volontairement (affirmation non
  // étayée) : on ne restaure pas l'original — sauf le résumé, dont l'absence
  // dégraderait visiblement le CV (journalisé).
  const summary = fixed[0] || cv.summary;
  if (!fixed[0] && cv.summary) console.warn("[proofread:cv] résumé vidé par la relecture, original conservé");
  let k = 1;
  const take = (arr: string[][]) => arr.map((bs) => bs.map(() => fixed[k++]).filter((b) => b && b.trim()));
  const exp = take(expBullets);
  const proj = take(projBullets);
  const edu = take(eduBullets);
  let out: GeneratedCV = {
    ...cv,
    summary,
    sections: {
      ...cv.sections,
      experiences: cv.sections.experiences.map((e, i) => ({ ...e, bullet_points: exp[i] })),
      projects: (cv.sections.projects ?? []).map((p, i) => ({ ...p, bullet_points: proj[i] })),
      educations: cv.sections.educations.map((e, i) => ({ ...e, bullet_points: edu[i] })),
    },
  };
  if (lang === "en") out = await translateShortFields(out);
  return out;
}

/**
 * CV en anglais : intitulés de poste, rôle du projet, diplômes/spécialités,
 * compétences, noms et niveaux de langues — traduits en bloc (un seul appel).
 * Ne sont pas envoyés : noms d'entreprises, d'écoles et de projets, ni les dates
 * (expDate rend déjà « Present » pour tout marqueur « en cours », et un
 * « March 2024 » renvoyé par le traducteur casserait le tri anti-chronologique).
 */
async function translateShortFields(cv: GeneratedCV): Promise<GeneratedCV> {
  const items: string[] = [];
  const setters: ((v: string) => void)[] = [];
  const add = (value: string | null | undefined, set: (v: string) => void) => {
    if (value && value.trim()) {
      items.push(value);
      setters.push(set);
    }
  };

  const experiences = cv.sections.experiences.map((e) => ({ ...e }));
  const projects = (cv.sections.projects ?? []).map((p) => ({ ...p }));
  const educations = cv.sections.educations.map((e) => ({ ...e }));
  const skills_flat = [...(cv.sections.skills_flat ?? [])];
  const languages = cv.sections.languages.map((l) => ({ ...l }));

  experiences.forEach((e) => {
    add(e.title, (v) => (e.title = v));
  });
  projects.forEach((p) => {
    add(p.role, (v) => (p.role = v));
  });
  educations.forEach((e) => {
    add(e.degree, (v) => (e.degree = v));
    add(e.field, (v) => (e.field = v));
  });
  skills_flat.forEach((s, i) => add(s, (v) => (skills_flat[i] = v)));
  languages.forEach((l) => {
    add(l.name, (v) => (l.name = v));
    add(l.level, (v) => (l.level = v));
  });

  if (!items.length) return cv;
  const translated = await translateToEnglish(items, "cv-fields");
  translated.forEach((v, i) => setters[i](v));
  return { ...cv, sections: { ...cv.sections, experiences, projects, educations, skills_flat, languages } };
}

/** Relit l'objet et les paragraphes de la lettre. */
export async function proofreadLM(lm: GeneratedLM, profile: ProfileFull, lang: DocLang = "fr"): Promise<GeneratedLM> {
  const texts = [lm.object, ...lm.body_paragraphs];
  let fixed = await proofreadTexts(texts, profile, "lm", lang);
  if (lang === "en") fixed = await ensureEnglish(fixed, "lm");
  const object = fixed[0] || lm.object;
  // Paragraphe vidé volontairement par la relecture : il reste vide (les templates filtrent les blancs).
  const body = fixed.slice(1);
  return { object, body_paragraphs: body };
}
