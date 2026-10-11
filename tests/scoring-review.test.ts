import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setSetting } from "@/lib/db";
import { providerBaseUrlSetting, providerModelsSetting } from "@/lib/ai/client";
import { BATCH_SIZE, descriptionExcerpt, reviewOffres } from "@/lib/ai/review-offres";
import {
  REVIEW_VERSION,
  aiExclusion,
  aiRelevance,
  isReviewCurrent,
  offerHash,
  parseReview,
  profileHash,
} from "@/lib/scoring/review";
import { scoreOffresLocal } from "@/lib/scoring/local";
import { EVAL_PROFILES } from "./eval/profiles";

const meta = { profile_hash: "p", offer_hash: "o", model: "m" };
const ba = EVAL_PROFILES.find((p) => p.key === "ba-junior")!.profile;

describe("réponse du modèle", () => {
  it("recalcule la part d'exigences couvertes au lieu de croire le modèle", () => {
    const r = parseReview(
      {
        verdict: "a_tenter",
        skills_fit: 95,
        role_fit: 80,
        reason: "Il manque SQL.",
        must_haves: [
          { requirement: "Recueil des besoins", covered: "oui", kind: "competence" },
          { requirement: "Rédaction de spécifications", covered: "partiel", kind: "competence" },
          { requirement: "SQL avancé", covered: "non", kind: "competence" },
          { requirement: "Assurance vie", covered: "oui", kind: "competence" },
          // Ni le diplôme ni les années n'entrent dans la part de compétences couvertes.
          { requirement: "Master", covered: "non", kind: "diplome" },
          { requirement: "5 ans d'expérience", covered: "non", kind: "experience" },
        ],
      },
      meta
    )!;
    expect(r.skills_fit).toBe(63); // (1 + 0,5 + 0 + 1) / 4
    expect(r.version).toBe(REVIEW_VERSION);
  });

  it("range le permis et ses semblables en conditions administratives, qui ne filtrent pas", () => {
    const kindOf = (requirement: string, kind = "competence") =>
      parseReview({ verdict: "a_tenter", role_fit: 50, must_haves: [{ requirement, kind, covered: "non" }] }, meta)!.must_haves[0].kind;
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

    const r = parseReview(
      {
        verdict: "hors_profil",
        role_fit: 100,
        must_haves: [
          { requirement: "Permis B titulaire", kind: "competence", covered: "non" },
          { requirement: "Maintenance CVC", kind: "competence", covered: "oui" },
        ],
      },
      meta
    )!;
    expect(r.skills_fit).toBe(100);
    expect(aiExclusion(r)).toBeNull();
  });

  it("rejette une réponse sans verdict exploitable, accepte les verdicts anglais", () => {
    expect(parseReview({ verdict: "peut-être", must_haves: [] }, meta)).toBeNull();
    expect(parseReview(null, meta)).toBeNull();
    expect(parseReview({ verdict: "mismatch", must_haves: [], skills_fit: 10, role_fit: 20 }, meta)!.verdict).toBe("hors_profil");
  });
});

describe("note et filtre de compétences", () => {
  const base = { ...meta, version: REVIEW_VERSION, model: "m", reviewed_at: "", reason: "" };

  it("le verdict ancre la note dans sa bande", () => {
    expect(aiRelevance({ ...base, must_haves: [], skills_fit: 40, role_fit: 40, verdict: "postuler" })).toBe(70);
    expect(aiRelevance({ ...base, must_haves: [], skills_fit: 100, role_fit: 100, verdict: "hors_profil" })).toBe(45);
  });

  it("écarte une offre hors profil faute de compétences, pas faute de métier", () => {
    const missing = [
      { requirement: "Java", covered: "non" as const, kind: "competence" as const },
      { requirement: "Spring Boot", covered: "non" as const, kind: "competence" as const },
      { requirement: "Agilité", covered: "oui" as const, kind: "competence" as const },
    ];
    expect(aiExclusion({ ...base, must_haves: missing, skills_fit: 33, role_fit: 20, verdict: "hors_profil" })).toBe(
      "compétences indispensables absentes : Java, Spring Boot"
    );
    expect(aiExclusion({ ...base, must_haves: [], skills_fit: 80, role_fit: 20, verdict: "hors_profil" })).toBeNull();
  });

  it("un diplôme ou des années manquants n'écartent pas : seules les compétences filtrent", () => {
    const r = parseReview(
      {
        verdict: "hors_profil",
        role_fit: 60,
        must_haves: [
          { requirement: "Master école de commerce", covered: "non", kind: "diplome" },
          { requirement: "4 ans de vente B2B", covered: "non", kind: "experience" },
          { requirement: "Prospection", covered: "oui", kind: "competence" },
        ],
      },
      meta
    )!;
    expect(r.skills_fit).toBe(100);
    expect(aiExclusion(r)).toBeNull();
  });

  it("une relecture n'est valable que pour le même profil et la même annonce", () => {
    const offre = { title: "Business Analyst", description_text: "Recueil des besoins." };
    const r = { ...base, profile_hash: profileHash(ba), offer_hash: offerHash(offre), must_haves: [], skills_fit: 50, role_fit: 50, verdict: "a_tenter" as const };
    expect(isReviewCurrent(r, profileHash(ba), offerHash(offre))).toBe(true);
    expect(isReviewCurrent(r, profileHash({ ...ba, target_titles: ["Data Analyst"] }), offerHash(offre))).toBe(false);
    expect(isReviewCurrent(r, profileHash(ba), offerHash({ ...offre, description_text: "Autre." }))).toBe(false);
  });

  it("dans la note, la relecture remplace la pertinence locale et son filtre passe en premier", () => {
    const offre = { title: "Business Analyst Assurance", company: "X", country: "France", description_text: "Recueil des besoins, spécifications fonctionnelles et recette en assurance vie." };
    const [local] = scoreOffresLocal(ba, [offre]);
    const review = { ...base, must_haves: [{ requirement: "Java", covered: "non" as const, kind: "competence" as const }], skills_fit: 0, role_fit: 30, verdict: "hors_profil" as const, reason: "Il vous manque Java." };
    const [withAi] = scoreOffresLocal(ba, [offre], undefined, [review]);
    expect(local.breakdown.excluded).toBeUndefined();
    expect(withAi.breakdown.excluded).toMatch(/^compétences indispensables absentes/);
    expect(withAi.score).toBeLessThanOrEqual(15);
    expect(withAi.reason).toContain("IA : Il vous manque Java.");
    expect(withAi.breakdown.ai_verdict).toBe("hors_profil");
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
          ? { offre_index: o.offre_index, must_haves: [{ requirement: "Java", kind: "competence", covered: "non" }, { requirement: "Spring", kind: "competence", covered: "non" }], role_fit: 20, verdict: "hors_profil", reason: "Il vous manque Java." }
          : { offre_index: o.offre_index, must_haves: [{ requirement: "Recette", kind: "competence", covered: "oui" }], role_fit: 100, verdict: "postuler", reason: "Profil couvert." }
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
