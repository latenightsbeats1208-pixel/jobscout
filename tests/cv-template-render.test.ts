import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { generateTemplateCv } from "@/lib/cvtemplate/generate";
import { assembleTemplateCv } from "@/lib/cvtemplate/assemble";
import { autoSelection } from "@/lib/cvtemplate/select";
import { fitTemplateCvToOnePage } from "@/lib/cvtemplate/render";
import { pdfPageCount } from "@/lib/pdf/render";
import { deleteCvTemplate, getCvTemplate, saveCvTemplate, seedFilePath } from "@/lib/cvtemplate/store";
import type { StructuredRequest } from "@/lib/ai/llm";
import { RAW_TEMPLATE, fixtureTemplate } from "./cv-template-fixture";

const offre = { title: "Ingénieur IA (H/F)", description_text: "LLM, Docker, Kubernetes.", country: "FR", company: "Exemple" };

async function pdfText(buf: Buffer): Promise<string> {
  const pdfParse = (await import("pdf-parse/lib/pdf-parse.js")).default as (b: Buffer) => Promise<{ text: string }>;
  return (await pdfParse(buf)).text;
}

describe("rendu PDF et DOCX", () => {
  it("une page, textes du modèle, DOCX valide", async () => {
    const r = await generateTemplateCv(fixtureTemplate(), offre, "fr", { aiConfigured: false });
    expect(await pdfPageCount(r.pdf)).toBe(1);
    const text = await pdfText(r.pdf);
    expect(text).toContain("Camille Martin");
    expect(text).toContain("Ingénieur IA");
    expect(text).toContain("Pipeline LLM sur [N] demandes");
    expect(r.docx.subarray(0, 2).toString()).toBe("PK"); // archive OOXML
    expect(r.doc.mode).toBe("auto");
  }, 60_000);

  it("contenu trop long : retire des puces du bas et le signale", async () => {
    const t = fixtureTemplate();
    const long = "Réalisation détaillée avec beaucoup de contexte technique et de résultats mesurés ".repeat(6);
    for (const s of t.sections) for (const e of s.entries) {
      e.max_bullets = 10;
      for (let i = 0; i < 8; i++) e.bullets.push({ id: `${e.id}-L${i}`, group: `${e.id}L${i}`, clusters: ["*"], text: { fr: long, en: long }, covers: [] });
    }
    const doc = assembleTemplateCv(t, autoSelection(t, offre, "fr"), offre, "fr");
    const { pdf, doc: fitted } = await fitTemplateCvToOnePage(doc);
    expect(await pdfPageCount(pdf)).toBe(1);
    expect(fitted.warnings.join(" ")).toMatch(/Puces retirées pour tenir sur une page/);
  }, 120_000);
});

describe("choix par l'IA", () => {
  it("utilise la réponse validée de l'IA", async () => {
    let seen: StructuredRequest | null = null;
    const call = async (req: StructuredRequest) => {
      seen = req;
      return {
        input: { cluster: "EMB", headline: "Ingénieur IA", bullets: [{ entry: "work", ids: ["W3", "W1-EMB"] }], extra_skills: [], reason: "test" },
        truncated: false,
        provider: "openai" as const,
        model: "fake",
      };
    };
    const r = await generateTemplateCv(fixtureTemplate(), offre, "fr", { aiConfigured: true, call });
    expect(r.selection.mode).toBe("ai");
    expect(r.selection.cluster).toBe("EMB");
    expect(r.selection.bullets.work).toEqual(["W3", "W1-EMB"]);
    // Le catalogue envoyé à l'IA liste les puces avec leurs clusters et groupes.
    expect(seen!.user).toContain("W1-AI [AI] {W1}");
    expect(seen!.tool.name).toBe("select_cv");
  }, 60_000);

  it("IA en échec : choix automatique et avertissement", async () => {
    const call = async () => {
      throw new Error("HTTP 500");
    };
    const r = await generateTemplateCv(fixtureTemplate(), offre, "fr", { aiConfigured: true, call });
    expect(r.selection.mode).toBe("auto");
    expect(r.doc.warnings[0]).toMatch(/Choix automatique/);
  }, 60_000);
});

describe("stockage du modèle", () => {
  it("importe data/cv-template.json au premier accès, puis respecte la suppression", () => {
    fs.mkdirSync(path.dirname(seedFilePath()), { recursive: true });
    fs.writeFileSync(seedFilePath(), JSON.stringify(RAW_TEMPLATE));
    expect(getCvTemplate()?.identity.full_name).toBe("Camille Martin");
    deleteCvTemplate();
    expect(getCvTemplate()).toBeNull(); // le fichier de départ n'est pas réimporté
    const saved = saveCvTemplate({ ...RAW_TEMPLATE, identity: { ...RAW_TEMPLATE.identity, full_name: "Autre Nom" } });
    expect(saved.ok).toBe(true);
    expect(getCvTemplate()?.identity.full_name).toBe("Autre Nom");
    expect(saveCvTemplate({ nope: true }).ok).toBe(false);
    expect(getCvTemplate()?.identity.full_name).toBe("Autre Nom");
  });
});
