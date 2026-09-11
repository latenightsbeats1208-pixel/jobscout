import "server-only";
import fs from "node:fs";
import path from "node:path";
import { getClaude, MODELS } from "./client";
import { AiContentError, assertNotTruncated } from "./errors";
import { validateLMAgainstProfile } from "./validate";
import { proofreadLM } from "./proofread";
import { profileFacts } from "./profile-facts";
import { lmLanguageInstruction } from "./lang-prompts";
import { detectDocLanguage, sourceLanguageHint, type DocLang } from "@/lib/text/lang";
import { countryNameEnglish } from "@/lib/countries";
import type { ProfileFull } from "@/lib/cv/types";
import type { OffreFiltered } from "@/lib/db/offres";

const TOOL = {
  name: "build_lm",
  description: "Construit la lettre de motivation (corps uniquement, 4 paragraphes Vous/Moi/Nous/Disponibilité).",
  input_schema: {
    type: "object",
    properties: {
      object: {
        type: "string",
        description: "Ligne d'objet, sans préfixe ('Objet :' / 'Subject:' / 'Re:')",
      },
      body_paragraphs: {
        type: "array",
        items: { type: "string" },
        minItems: 4,
        maxItems: 4,
        description: "Exactement 4 paragraphes : Vous (entreprise + accroche), Moi (preuves chiffrées), Nous (alignement), Disponibilité (entretien + remerciement).",
      },
    },
    required: ["object", "body_paragraphs"],
  },
} as const;

export type GeneratedLM = { object: string; body_paragraphs: string[] };

// Prompt content is read lazily on first call. Bump the suffix to force a
// re-read after editing the markdown file in dev (HMR resets module state).
let _system: string | null = null; // v3 — langue de sortie + chronologie datée

export async function generateLM(
  profile: ProfileFull,
  offre: OffreFiltered,
  lang: DocLang = detectDocLanguage(offre.title, offre.description_text, sourceLanguageHint(offre.source, offre.raw_payload), offre.country)
): Promise<GeneratedLM> {
  if (!_system) _system = fs.readFileSync(path.join(process.cwd(), "prompts", "generate-lm.md"), "utf-8");
  const client = getClaude();
  const message = await client.messages.create({
    model: MODELS.opus,
    max_tokens: 2000,
    system: [{ type: "text", text: _system, cache_control: { type: "ephemeral" } }],
    tools: [TOOL as any],
    tool_choice: { type: "tool", name: "build_lm" },
    messages: [
      {
        role: "user",
        content:
          `${lmLanguageInstruction(lang)}

## Faits du profil — SEULE source autorisée pour le §2 (dates, puces, outils par expérience)\n${profileFacts(profile)}\n\n` +
          `## Offre\n- Titre: ${offre.title}\n- Entreprise: ${offre.company || "(non précisée dans l'annonce)"}\n- Lieu de l'offre: ${[offre.location, offre.country].filter(Boolean).join(", ") || "(non précisé)"}\n- Ville du candidat: ${profile.location ?? "(non précisée)"}\n- Description:\n${offre.description_text.slice(0, 5000)}\n\nRédige la lettre de motivation${lang === "en" ? " — entièrement en anglais" : ""}.`,
      },
    ],
  });
  assertNotTruncated(message, "la lettre de motivation");
  const t = message.content.find((b) => b.type === "tool_use");
  if (!t || t.type !== "tool_use")
    throw new AiContentError(
      "La réponse IA pour la lettre de motivation est vide — relancez la génération."
    );
  const shaped = enforceLMShape(t.input);
  // Sortie vide = document vide écrit sur disque et annoncé comme réussi :
  // aucune des routes ne vérifiait la non-vacuité.
  if (shaped.body_paragraphs.join("").trim().length < 50) {
    throw new AiContentError(
      "La réponse IA pour la lettre de motivation est inexploitable (contenu vide) — relancez la génération."
    );
  }
  // Anti-hallucination: log unverified company mentions (no auto-strip on prose)
  const { warnings } = validateLMAgainstProfile(shaped, profile);
  if (warnings.length > 0) {
    console.log(`[generateLM] anti-hallucination warnings:`);
    for (const w of warnings) console.log(`  • ${w}`);
  }
  // Relecture (orthographe, accords, typographie, faits non étayés) — jamais bloquante.
  const proofread = await proofreadLM(shaped, profile, lang);
  // Garde-fou mobilité : le lieu de l'offre doit être nommé quand il diffère de la ville du candidat.
  return ensureMobility(proofread, profile, offre, lang);
}

/**
 * Defensive normalization of the cover letter:
 * - Strips a leading "Objet :" the model may have added
 * - Removes any salutation/closing the model might have inserted into body paragraphs
 * - Caps to exactly 3 paragraphs
 */
function enforceLMShape(input: unknown): GeneratedLM {
  // La sortie d'outil n'est pas garantie conforme au schéma : on ne la caste
  // pas, on lit défensivement chaque champ.
  const lm = (input ?? {}) as Partial<GeneratedLM>;
  const object = (typeof lm.object === "string" ? lm.object : "")
    .replace(/^\s*(?:objet|object|subject|re)\s*[:\-–—]\s*/i, "")
    .trim();

  // Français et anglais : le template ajoute lui-même salutation et formule finale.
  const SALUT_RE = /^\s*((madame|monsieur|ch[eè]re?s?|bonjour)\b|à\s+l'attention|dear\b|hello\b|to\s+whom\s+it\s+may\s+concern)/i;
  // « Dans l'attente… » et « Je vous saurais gré… » ouvrent souvent un vrai §4 : ce ne sont pas des formules finales.
  const CLOSE_RE = /^\s*(je\s+vous\s+prie\s+d|veuillez\s+(agréer|recevoir)|(bien\s+)?cordialement\b|sincèrement\b|(yours\s+)?sincerely\b|yours\s+(faithfully|truly)\b|(best|kind|warm)\s+regards\b|regards\b)/i;
  const words = (p: string) => p.split(/\s+/).filter(Boolean).length;
  const cleaned = (Array.isArray(lm.body_paragraphs) ? lm.body_paragraphs : [])
    .filter((p): p is string => typeof p === "string")
    .map((p) => p.trim())
    .map((p) => {
      if (!p) return "";
      if (SALUT_RE.test(p)) {
        // Salutation seule → supprimée ; salutation en tête d'un vrai paragraphe → retirée, le paragraphe reste.
        if (words(p) <= 8) return "";
        let q = p;
        for (let i = 0; i < 3 && SALUT_RE.test(q); i++) q = q.replace(/^\s*[^,:\n]{0,60}[,:]\s*/, "").trim();
        return q;
      }
      // Formule finale seule (courte) → supprimée ; un long paragraphe qui commence ainsi est conservé.
      if (CLOSE_RE.test(p) && words(p) <= 25) return "";
      return p;
    })
    .filter(Boolean);

  // Force exactly 4 paragraphs
  const paragraphs = cleaned.slice(0, 4);
  while (paragraphs.length < 4) paragraphs.push("");

  return { object, body_paragraphs: paragraphs };
}

/* ------------------------------------------------------------------ */
/* Mobilité : le lieu de l'offre doit être nommé                        */
/* ------------------------------------------------------------------ */

function foldText(v: string | null | undefined): string {
  return (v ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
}

const MOBILITY_TOOL = {
  name: "return_paragraph",
  description: "Le paragraphe corrigé, seul.",
  input_schema: { type: "object", properties: { paragraph: { type: "string" } }, required: ["paragraph"] },
} as const;

/**
 * Règle 10 du prompt : si le lieu de l'offre diffère de la ville du candidat,
 * le §4 doit nommer ce lieu. Le modèle (ou la relecture) l'omet parfois
 * (« I am ready to relocate. » sans destination). Vérification déterministe,
 * puis réparation ciblée du seul §4 par Sonnet — jamais bloquante.
 */
async function ensureMobility(
  lm: GeneratedLM,
  profile: ProfileFull,
  offre: OffreFiltered,
  lang: DocLang
): Promise<GeneratedLM> {
  const city = (offre.location ?? "").split(/[,(]/)[0].trim();
  const countryFr = (offre.country ?? "").trim();
  const countryEn = lang === "en" ? countryNameEnglish(countryFr) ?? "" : "";
  const candidateCity = (profile.location ?? "").split(",")[0].trim();
  const names = [city, countryFr, countryEn].filter((n) => n.length >= 3);
  if (!names.length) return lm;
  if (city && candidateCity && foldText(city) === foldText(candidateCity)) return lm;
  // Ville « Télétravail », « Remote »… : rien à nommer.
  if (/^(t[ée]l[ée]travail|remote|full remote|hybride?|hybrid)$/i.test(city)) return lm;
  const body = foldText(lm.body_paragraphs.join("\n"));
  if (names.some((n) => body.includes(foldText(n)))) return lm;

  const idx = lm.body_paragraphs.map((p, i) => (p && p.trim() ? i : -1)).filter((i) => i >= 0).pop();
  if (idx === undefined) return lm;
  const place = [city, lang === "en" ? countryEn || countryFr : countryFr].filter(Boolean).join(", ");
  console.log(`[generateLM] mobilité : lieu « ${place} » absent de la lettre — réparation du §4`);
  try {
    const client = getClaude();
    const message = await client.messages.create({
      model: MODELS.sonnet,
      max_tokens: 800,
      system:
        lang === "en"
          ? "You edit ONE paragraph of a cover letter. Insert, naturally, an explicit sentence of availability and mobility that names the job location given (on-site interview there or by video call, readiness to relocate). Keep every other sentence unchanged, same language (English), no salutation, no sign-off. Return only the paragraph via the tool."
          : "Tu modifies UN paragraphe d'une lettre de motivation. Insère, naturellement, une phrase explicite de disponibilité et de mobilité qui nomme le lieu de l'offre indiqué (entretien sur place ou en visioconférence, mobilité vers ce lieu). Conserve toutes les autres phrases à l'identique, même langue (français), sans salutation ni formule de politesse. Renvoie uniquement le paragraphe via l'outil.",
      tools: [MOBILITY_TOOL as any],
      tool_choice: { type: "tool", name: "return_paragraph" },
      messages: [
        {
          role: "user",
          content: `Job location: ${place}\nCandidate city: ${candidateCity || "(unknown)"}\n\nParagraph:\n${lm.body_paragraphs[idx]}`,
        },
      ],
    });
    const t = message.content.find((b) => b.type === "tool_use");
    const out = t && t.type === "tool_use" ? (t.input as { paragraph?: unknown }).paragraph : null;
    if (typeof out !== "string" || out.trim().length < 20) throw new Error("paragraphe vide");
    if (!names.some((n) => foldText(out).includes(foldText(n)))) throw new Error("lieu toujours absent");
    const body_paragraphs = [...lm.body_paragraphs];
    body_paragraphs[idx] = out.trim();
    return { ...lm, body_paragraphs };
  } catch (e) {
    console.warn("[generateLM] réparation mobilité ignorée :", e instanceof Error ? e.message : e);
    return lm;
  }
}
