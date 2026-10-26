import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseCvTemplate } from "@/lib/cvtemplate/types";
import {
  acceptHeadline,
  autoSelection,
  cleanHeadline,
  extraSkills,
  findPlaceholders,
  pickCluster,
  selectBullets,
  validateSelection,
} from "@/lib/cvtemplate/select";
import { assembleTemplateCv, templateCvFacts } from "@/lib/cvtemplate/assemble";
import { RAW_TEMPLATE, fixtureTemplate } from "./cv-template-fixture";

const aiOffer = { title: "Ingénieur IA / LLM (H/F) - CDI", description_text: "LLM, RAG, Python, Kubernetes et Docker.", country: "FR" };
const embOffer = { title: "Ingénieur embarqué F/H", description_text: "Firmware, Yocto, bus CAN, C++.", country: "CH" };

describe("validation du modèle", () => {
  it("accepte le modèle fictif", () => {
    expect(() => fixtureTemplate()).not.toThrow();
  });

  it("signale les références inconnues et les doublons", () => {
    const raw = structuredClone(RAW_TEMPLATE) as any;
    raw.clusters[0].order = ["experience", "nope"];
    raw.clusters[0].priority = ["ZZZ"];
    raw.sections[0].entries[0].bullets[1].id = "W1-AI";
    raw.sections[1].entries[0].bullets[0].clusters = ["XX"];
    const r = parseCvTemplate(raw);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    const all = r.errors.join("\n");
    expect(all).toMatch(/section « nope » inconnue/);
    expect(all).toMatch(/puce prioritaire « ZZZ » inconnue/);
    expect(all).toMatch(/puce « W1-AI » en double/);
    expect(all).toMatch(/cluster « XX » inconnu/);
  });

  it("refuse un JSON sans clusters", () => {
    const r = parseCvTemplate({ identity: { full_name: "x", contact: ["y"] }, clusters: [], sections: [] });
    expect(r.ok).toBe(false);
  });
});

describe("choix automatique", () => {
  const t = fixtureTemplate();

  it("choisit le cluster par l'intitulé et les mots-clés", () => {
    expect(pickCluster(t, aiOffer).id).toBe("AI");
    expect(pickCluster(t, embOffer).id).toBe("EMB");
    // Aucun indice : le premier cluster du modèle.
    expect(pickCluster(t, { title: "Comptable", description_text: "bilan" }).id).toBe("AI");
  });

  it("une seule version par fait, priorités, limites du cluster", () => {
    const ai = selectBullets(t, t.clusters[0]);
    expect(ai.work).toEqual(["W1-AI", "W2"]);
    // P1, P3 servent AI ; PALL (« * ») résume P3, déjà retenue → exclue.
    expect(ai.side).toEqual(["P1", "P3"]);
    expect(ai["only-ai"]).toEqual(["H1"]);

    const emb = selectBullets(t, t.clusters[1]);
    // W1-EMB et W1-AI sont le même fait (groupe W1) : jamais les deux.
    expect(emb.work).toEqual(["W1-EMB", "W2"]);
    expect(emb.side).toEqual(["P2"]); // limite du cluster EMB : 1
    // Entrée facultative sans puce du cluster : absente.
    expect(emb["only-ai"]).toBeUndefined();
  });

  it("complète jusqu'au minimum avec des puces hors cluster", () => {
    const raw = structuredClone(RAW_TEMPLATE) as any;
    raw.sections[0].entries[0].bullets = raw.sections[0].entries[0].bullets.map((b: any) => ({ ...b, clusters: b.id === "W3" ? ["AI"] : ["EMB"] }));
    const r = parseCvTemplate(raw);
    if (!r.ok) throw new Error(r.errors.join());
    expect(selectBullets(r.template, r.template.clusters[0]).work).toEqual(["W3", "W1-AI"]);
  });

  it("titre : intitulé de l'offre sans genre ni contrat", () => {
    expect(cleanHeadline("Ingénieur IA / LLM (H/F) - CDI")).toBe("Ingénieur IA / LLM");
    expect(cleanHeadline("Data Engineer F/H | Stage")).toBe("Data Engineer");
    expect(cleanHeadline("Développeur Full-Stack (CDI)")).toBe("Développeur Full-Stack");
    expect(cleanHeadline("ML Engineer - Lausanne")).toBe("ML Engineer - Lausanne");
    expect(autoSelection(t, aiOffer, "fr").headline).toBe("Ingénieur IA / LLM");
  });

  it("titre proposé : seulement des mots de l'offre", () => {
    expect(acceptHeadline("Ingénieur IA / LLM", aiOffer.title)).toBe("Ingénieur IA / LLM");
    expect(acceptHeadline("Ingénieur IA Senior", aiOffer.title)).toBeNull();
    expect(acceptHeadline("", aiOffer.title)).toBeNull();
  });

  it("mots-clés en plus : présents dans l'offre, défendables, hors bloc du cluster", () => {
    const ai = t.clusters[0];
    // Kubernetes (mot-clé confirmé) et Docker (bloc EMB) figurent dans l'offre ; Python est déjà dans le bloc AI ; RAG n'est nulle part.
    expect(extraSkills(t, ai, aiOffer, "fr")).toEqual(["Docker", "Kubernetes"]);
    // Proposition de l'IA filtrée par les mêmes règles.
    expect(extraSkills(t, ai, aiOffer, "fr", ["RAG", "kubernetes", "Python"])).toEqual(["Kubernetes"]);
  });

  it("emplacements non remplis", () => {
    expect(findPlaceholders("validé sur [N] demandes depuis [mois] 2025")).toEqual(["[N]", "[mois]"]);
    expect(findPlaceholders("C++ [x] y")).toEqual(["[x]"]);
    expect(findPlaceholders("aucun")).toEqual([]);
  });
});

describe("choix proposé par l'IA, validé", () => {
  const t = fixtureTemplate();

  it("garde ce qui respecte les règles, corrige le reste", () => {
    const sel = validateSelection(t, aiOffer, "fr", {
      cluster: "AI",
      headline: "Ingénieur LLM",
      bullets: [
        { entry: "work", ids: ["W2", "W1-AI", "W1-EMB", "INCONNU"] },
        { entry: "side", ids: ["PALL", "P3"] },
        { entry: "only-ai", ids: [] },
      ],
      extra_skills: ["Kubernetes", "Rust"],
      reason: "offre LLM",
    });
    expect(sel.mode).toBe("ai");
    expect(sel.headline).toBe("Ingénieur LLM");
    expect(sel.bullets.work).toEqual(["W2", "W1-AI"]); // W1-EMB = même fait que W1-AI ; limite 2
    expect(sel.bullets.side).toEqual(["PALL"]); // PALL résume P3
    expect(sel.bullets["only-ai"]).toBeUndefined(); // entrée facultative écartée
    expect(sel.extraSkills).toEqual(["Kubernetes"]);
  });

  it("cluster inconnu et titre inventé : repli automatique", () => {
    const sel = validateSelection(t, embOffer, "fr", { cluster: "ZZ", headline: "Architecte senior", bullets: "n'importe quoi" });
    expect(sel.cluster).toBe("EMB");
    expect(sel.headline).toBe("Ingénieur embarqué");
    expect(sel.bullets.work).toEqual(["W1-EMB", "W2"]);
  });
});

describe("assemblage", () => {
  const t = fixtureTemplate();

  it("ordre des sections du cluster, ligne d'identité selon le pays, avertissements", () => {
    const doc = assembleTemplateCv(t, autoSelection(t, embOffer, "fr"), embOffer, "fr");
    expect(doc.sections.map((s) => s.id)).toEqual(["projects", "experience"]);
    expect(doc.tagline).toBe("Citoyenne UE, éligible au permis B");
    expect(doc.headline).toBe("Ingénieur embarqué");
    // Typographie française : espace insécable avant « : » dans les textes.
    expect(doc.skills[0].items).toContain("C++");
    expect(doc.warnings).toEqual([]);

    // Pays écrit en toutes lettres par les sources.
    for (const name of ["Suisse", "Switzerland", "CH"]) {
      const named = { ...embOffer, country: name };
      expect(assembleTemplateCv(t, autoSelection(t, named, "fr"), named, "fr").tagline).toBe("Citoyenne UE, éligible au permis B");
    }

    const fr = assembleTemplateCv(t, autoSelection(t, aiOffer, "fr"), aiOffer, "fr");
    expect(fr.tagline).toBe("Disponible en mars 2027");
    expect(fr.warnings.join(" ")).toMatch(/\[N\] \(W1-AI\)/);
    expect(fr.skills.at(-1)).toEqual({ label: "Autres", items: "Docker, Kubernetes" });
  });

  it("anglais : textes anglais, repli français signalé", () => {
    const doc = assembleTemplateCv(t, autoSelection(t, embOffer, "en"), embOffer, "en");
    expect(doc.sections.find((s) => s.id === "experience")!.entries[0].heading).toBe("Intern — Acme");
    expect(doc.profile).toBe("Ingénieure embarqué, Linux et CAN.");
    expect(doc.warnings.join(" ")).toMatch(/Texte anglais manquant/);
    expect(doc.warnings.join(" ")).toMatch(/profil EMB/);
    expect(doc.warnings.join(" ")).toMatch(/compétences EMB/);
  });

  it("faits pour la lettre : exactement le contenu du CV", () => {
    const doc = assembleTemplateCv(t, autoSelection(t, aiOffer, "fr"), aiOffer, "fr");
    const facts = templateCvFacts(doc);
    expect(facts).toContain("Pipeline LLM sur [N] demandes");
    expect(facts).toContain("Stagiaire — Acme");
    expect(facts).not.toContain("Outil CAN généré par LLM");
  });
});

describe("prompt de sélection", () => {
  it("existe et impose l'outil select_cv", () => {
    const text = fs.readFileSync(path.join(process.cwd(), "prompts", "select-cv-template.md"), "utf-8");
    expect(text).toContain("select_cv");
  });
});
