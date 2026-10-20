import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setSetting } from "@/lib/db";
import { providerBaseUrlSetting, providerModelsSetting } from "@/lib/ai/client";
import { BATCH_SIZE, descriptionExcerpt, reviewOffres } from "@/lib/ai/review-offres";
import {
  REVIEW_VERSION,
  aiFactor,
  effectiveVerdict,
  isReviewCurrent,
  isReviewUsable,
  offerHash,
  parseReview,
  profileHash,
  reviewReason,
} from "@/lib/scoring/review";
import { scoreOffresLocal } from "@/lib/scoring/local";
import { EVAL_PROFILES } from "./eval/profiles";

const meta = { profile_hash: "p", offer_hash: "o", model: "m" };
const ba = EVAL_PROFILES.find((p) => p.key === "ba-junior")!.profile;

/** Exigence telle que le modèle la rend ; par défaut, il cite l'exigence elle-même. */
const mh = (requirement: string, covered: string, kind = "competence", citation = requirement) => ({ requirement, covered, kind, citation });
/** Annonce qui contient chacun des textes donnés. */
const adWith = (...texts: string[]) => ({ title: "Poste", description_text: texts.join(". ") });

describe("réponse du modèle", () => {
  it("recalcule la part d'exigences couvertes au lieu de croire le modèle", () => {
    const musts = [
      mh("Recueil des besoins", "oui"),
      mh("Rédaction de spécifications", "partiel"),
      mh("SQL avancé", "non"),
      mh("Assurance vie", "oui"),
      // Ni le diplôme ni les années n'entrent dans la part de compétences couvertes.
      mh("Master", "non", "diplome"),
      mh("5 ans d'expérience", "non", "experience"),
    ];
    const r = parseReview(
      { verdict: "a_tenter", skills_fit: 95, role_fit: 80, reason: "Il manque SQL.", must_haves: musts },
      meta,
      adWith(...musts.map((m) => m.requirement))
    )!;
    expect(r.skills_fit).toBe(63); // (1 + 0,5 + 0 + 1) / 4
    expect(r.version).toBe(REVIEW_VERSION);
  });

  it("range le permis et ses semblables en conditions administratives, qui ne filtrent pas", () => {
    const kindOf = (requirement: string, kind = "competence") =>
      parseReview({ verdict: "a_tenter", role_fit: 50, must_haves: [mh(requirement, "non", kind)] }, meta, adWith(requirement))!
        .must_haves[0].kind;
    // Le modèle les a déjà classés en compétences (relectures réelles du banc) : le filet les rattrape.
    expect(kindOf("Permis B obligatoire")).toBe("administratif");
    expect(kindOf("Permis B titulaire")).toBe("administratif");
    expect(kindOf("Être véhiculé")).toBe("administratif");
    expect(kindOf("Véhiculée")).toBe("administratif");
    expect(kindOf("Astreintes le week-end")).toBe("administratif");
    // Des véhicules comme objet de travail restent des compétences.
    expect(kindOf("Simulation numérique pour véhicules")).toBe("competence");
    expect(kindOf("Modélisation R&D de véhicules")).toBe("competence");
    expect(kindOf("Maintenance de véhicule électrique")).toBe("competence");
    expect(kindOf("Permis B", "administratif")).toBe("administratif");

    const musts = [mh("Permis B titulaire", "non"), mh("Maintenance CVC", "oui")];
    const r = parseReview({ verdict: "hors_profil", role_fit: 100, must_haves: musts }, meta, adWith("Permis B titulaire", "Maintenance CVC"))!;
    expect(r.skills_fit).toBe(100);
  });

  it("rejette une réponse sans verdict exploitable, accepte les verdicts anglais", () => {
    expect(parseReview({ verdict: "peut-être", must_haves: [] }, meta, adWith())).toBeNull();
    expect(parseReview(null, meta, adWith())).toBeNull();
    expect(parseReview({ verdict: "mismatch", must_haves: [], skills_fit: 10, role_fit: 20 }, meta, adWith())!.verdict).toBe("hors_profil");
  });
});

describe("exigences citées ou déduites", () => {
  // Annonce réelle du banc (France Travail, 354 caractères) : rien n'y parle d'alimentaire ni de management.
  const shortAd = {
    title: "Chef des Ventes & Compte Clé - Start-Up Food H/F",
    description_text:
      "Commercial (H/F) MANPOWER FRANCE - 77 - Combs-la-Ville. Manpower recrute pour son client un commercial terrain. " +
      "Vous développez un portefeuille de clients et assurez le suivi des commandes.",
  };

  it("une exigence introuvable dans l'annonce est déduite : affichée, sans filtrer ni compter", () => {
    const r = parseReview(
      {
        verdict: "hors_profil",
        role_fit: 40,
        must_haves: [
          mh("Expérience secteur food", "non", "competence", "expérience dans l'agroalimentaire exigée"),
          mh("Management d'équipe commerciale", "non", "competence", ""),
        ],
      },
      meta,
      shortAd
    )!;
    expect(r.must_haves.every((m) => !m.verified)).toBe(true);
    expect(isReviewUsable(r)).toBe(false);
  });

  it("une citation reconnue malgré accents, majuscules et pluriels", () => {
    const r = parseReview(
      { verdict: "a_tenter", role_fit: 80, must_haves: [mh("Relais de protection", "non", "competence", "maitrise des Relais de protections")] },
      meta,
      adWith("Maîtrise des relais de protection")
    )!;
    expect(r.must_haves[0].verified).toBe(true);
  });

  it("dans la note, une relecture sans exigence vérifiable laisse la note locale", () => {
    const offre = { ...shortAd, company: "Manpower", country: "France" };
    const [local] = scoreOffresLocal(ba, [offre]);
    const review = parseReview(
      { verdict: "hors_profil", role_fit: 10, reason: "Autre métier.", must_haves: [mh("Expérience secteur food", "non", "competence", "")] },
      meta,
      shortAd
    )!;
    const [withAi] = scoreOffresLocal(ba, [offre], undefined, [review]);
    expect(withAi.score).toBe(local.score);
    expect(withAi.breakdown.ai_verdict).toBeUndefined();
    expect(withAi.reason).toContain("annonce trop courte pour juger les exigences");
  });
});

describe("note et filtre de compétences", () => {
  const base = { ...meta, version: REVIEW_VERSION, model: "m", reviewed_at: "", reason: "" };
  const verified = (requirement: string, covered: "oui" | "partiel" | "non") =>
    ({ requirement, covered, kind: "competence" as const, citation: requirement, verified: true });

  it("le verdict réduit la note locale, il ne la remplace pas", () => {
    expect(aiFactor({ ...base, must_haves: [], skills_fit: 100, role_fit: 100, verdict: "postuler" })).toBe(1);
    expect(aiFactor({ ...base, must_haves: [], skills_fit: 50, role_fit: 50, verdict: "a_tenter" })).toBeLessThan(1);
    expect(aiFactor({ ...base, must_haves: [], skills_fit: 0, role_fit: 0, verdict: "hors_profil" })).toBeLessThan(
      aiFactor({ ...base, must_haves: [], skills_fit: 0, role_fit: 0, verdict: "a_tenter" })
    );
  });

  it("même métier mais autre spécialité (EHPAD pour une infirmière des urgences) : la note cède un peu", () => {
    const same = aiFactor({ ...base, must_haves: [], skills_fit: 100, role_fit: 100, verdict: "postuler" });
    const other = aiFactor({ ...base, must_haves: [], skills_fit: 100, role_fit: 80, verdict: "postuler" });
    expect(other).toBeLessThan(same);
    expect(other).toBeGreaterThan(aiFactor({ ...base, must_haves: [], skills_fit: 100, role_fit: 100, verdict: "hors_profil" }));
  });

  it("un diplôme ou des années manquants ne comptent pas dans les compétences couvertes", () => {
    const musts = [mh("Master école de commerce", "non", "diplome"), mh("4 ans de vente B2B", "non", "experience"), mh("Prospection", "oui")];
    const r = parseReview({ verdict: "hors_profil", role_fit: 60, must_haves: musts }, meta, adWith(...musts.map((m) => m.requirement)))!;
    expect(r.skills_fit).toBe(100);
  });

  it("une relecture n'est valable que pour le même profil et la même annonce", () => {
    const offre = { title: "Business Analyst", description_text: "Recueil des besoins." };
    const r = { ...base, profile_hash: profileHash(ba), offer_hash: offerHash(offre), must_haves: [], skills_fit: 50, role_fit: 50, verdict: "a_tenter" as const };
    expect(isReviewCurrent(r, profileHash(ba), offerHash(offre))).toBe(true);
    expect(isReviewCurrent(r, profileHash({ ...ba, target_titles: ["Data Analyst"] }), offerHash(offre))).toBe(false);
    expect(isReviewCurrent(r, profileHash(ba), offerHash({ ...offre, description_text: "Autre." }))).toBe(false);
  });

  it("dans la note, un « hors profil » descend sans être écarté (banc marché : l'IA écartait 20 bonnes offres)", () => {
    const offre = { title: "Business Analyst Assurance", company: "X", country: "France", description_text: "Recueil des besoins, spécifications fonctionnelles et recette en assurance vie." };
    const [local] = scoreOffresLocal(ba, [offre]);
    const review = { ...base, must_haves: [verified("Java", "non")], skills_fit: 0, role_fit: 30, verdict: "hors_profil" as const, reason: "Il vous manque Java." };
    const [withAi] = scoreOffresLocal(ba, [offre], undefined, [review]);
    expect(withAi.breakdown.excluded).toBeUndefined();
    expect(withAi.score).toBeLessThan(local.score);
    expect(withAi.score).toBeGreaterThan(15);
    expect(withAi.reason).toContain("IA : Il vous manque Java.");
    expect(withAi.breakdown.ai_verdict).toBe("hors_profil");
  });
});

describe("titre obligatoire pour exercer", () => {
  // Audit d'octobre 2026 : la même annonce de chef d'équipe SSIAP 2, relue deux fois,
  // est sortie « hors profil » puis « à tenter » (« votre profil SSIAP 1 reste défendable »).
  const ad = adWith("Diplôme SSIAP 2 à jour indispensable", "Carte professionnelle CNAPS", "Bonne présentation");
  const review = (covered: string) =>
    parseReview(
      { verdict: "a_tenter", role_fit: 100, reason: "Votre profil SSIAP 1 expérimenté reste défendable.", must_haves: [mh("Diplôme SSIAP 2 à jour", covered, "diplome", "Diplôme SSIAP 2 à jour indispensable"), mh("Bonne présentation", "oui")] },
      meta,
      ad
    )!;

  it("absent du profil : « hors profil », quoi qu'en dise le modèle, et la raison le nomme", () => {
    const r = review("non");
    expect(effectiveVerdict(r)).toBe("hors_profil");
    expect(aiFactor(r)).toBe(0.6);
    expect(reviewReason(r)).toBe("Diplôme SSIAP 2 à jour : exigé pour exercer, absent de votre profil.");
  });

  it("présent, ou seulement en cours : le verdict du modèle reste", () => {
    expect(effectiveVerdict(review("oui"))).toBe("a_tenter");
    expect(effectiveVerdict(review("partiel"))).toBe("a_tenter");
  });

  it("une habilitation ou un CACES ne bloquent pas : ils se passent chez l'employeur", () => {
    const r = parseReview({ verdict: "postuler", role_fit: 100, must_haves: [mh("CACES R489", "non")] }, meta, adWith("CACES R489"))!;
    expect(effectiveVerdict(r)).toBe("postuler");
  });
});

describe("extrait d'annonce envoyé au modèle", () => {
  it("garde le début du poste et le bloc « profil recherché » d'une annonce longue", () => {
    const text = `${"Présentation de l'entreprise. ".repeat(80)}Profil recherché : maîtrise de SQL et de la recette.${" Avantages.".repeat(200)}`;
    const excerpt = descriptionExcerpt(text);
    expect(excerpt.length).toBeLessThanOrEqual(2700);
    expect(excerpt).toContain("Profil recherché : maîtrise de SQL");
  });
});

// ---------------------------------------------------------------------------
// De bout en bout, contre un faux serveur compatible OpenAI : aucun appel payant.
// ---------------------------------------------------------------------------

const calls: { model: string; count: number }[] = [];
let server: http.Server;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const body = JSON.parse(raw) as { model: string; messages: { role: string; content: string }[] };
      const user = body.messages.find((m) => m.role === "user")!.content;
      const offres = JSON.parse(user.slice(user.indexOf("["))) as { offre_index: number; intitule: string }[];
      calls.push({ model: body.model, count: offres.length });
      const results = offres.map((o) =>
        o.intitule.includes("Java")
          ? { offre_index: o.offre_index, must_haves: [{ requirement: "Java", kind: "competence", covered: "non", citation: "Java" }, { requirement: "Spring", kind: "competence", covered: "non", citation: "Spring" }], role_fit: 20, verdict: "hors_profil", reason: "Il vous manque Java." }
          : { offre_index: o.offre_index, must_haves: [{ requirement: "Recette", kind: "competence", covered: "oui", citation: "Recette" }], role_fit: 100, verdict: "postuler", reason: "Profil couvert." }
      );
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        choices: [{ finish_reason: "tool_calls", message: { content: null, tool_calls: [{ type: "function", function: { name: "review_offres", arguments: JSON.stringify({ results }) } }] } }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      }));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  setSetting("llm:mode", "byok");
  setSetting("llm:provider", "custom");
  setSetting(providerBaseUrlSetting("custom"), `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`);
  setSetting(providerModelsSetting("custom"), JSON.stringify({ writer: "modele-redaction", reviewer: "modele-relecture" }));
});

afterAll(() => new Promise<void>((r) => server.close(() => r())));

describe("relecture de bout en bout", () => {
  it("relit par lots avec le modèle de relecture et rattache chaque verdict à son offre", async () => {
    const offres = Array.from({ length: BATCH_SIZE + 2 }, (_, i) => ({
      title: i % 3 === 0 ? "Développeur Java" : "Business Analyst",
      company: "X",
      country: "France",
      description_text: `Annonce ${i}`,
    }));
    const { reviews, failedBatches } = await reviewOffres(ba, offres);
    expect(calls.map((c) => c.count)).toEqual([BATCH_SIZE, 2]);
    expect(calls.every((c) => c.model === "modele-relecture")).toBe(true);
    expect(failedBatches).toBe(0);
    expect(reviews.map((r) => r!.verdict)).toEqual(offres.map((o) => (o.title.includes("Java") ? "hors_profil" : "postuler")));
    expect(reviews[0]!.offer_hash).toBe(offerHash(offres[0]));
  });
});

describe("un avis par annonce publiée deux fois", () => {
  it("les doublons partagent l'avis le plus sévère, et une copie jamais relue le reçoit", async () => {
    const { currentReviews } = await import("@/lib/scoring/rescore");
    const offer = (id: number, duplicate_of: number | null, text: string) => ({
      id, duplicate_of, title: "Chef d'équipe SSIAP 2", company: "Triomphe", country: "France", location: "Chennevières",
      description_text: text, contract_type: "CDI", description_status: "ok", ai_review: null as string | null,
    });
    const review = (o: { title: string; description_text: string }, verdict: string) =>
      JSON.stringify(parseReview({ verdict, role_fit: 100, reason: verdict, must_haves: [mh("Encadrement d'équipe", "oui")] }, { profile_hash: profileHash(ba), offer_hash: offerHash(o), model: "m" }, adWith("Encadrement d'équipe")));
    const ft = offer(23, null, "Annonce France Travail. Encadrement d'équipe.");
    const hw = offer(57, 23, "Annonce HelloWork. Encadrement d'équipe.");
    const lw = offer(58, 23, "Troisième copie, jamais relue. Encadrement d'équipe.");
    ft.ai_review = review(ft, "a_tenter");
    hw.ai_review = review(hw, "hors_profil");
    const reviews = currentReviews(ba, [ft, hw, lw]);
    expect(reviews.map((r) => r?.verdict)).toEqual(["hors_profil", "hors_profil", "hors_profil"]);
  });
});
