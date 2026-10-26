import "server-only";
import fs from "node:fs";
import path from "node:path";
import { callStructured, type StructuredRequest, type StructuredResult, type StructuredTool } from "@/lib/ai/llm";
import type { DocLang } from "@/lib/text/lang";
import { bulletGroup, type CvTemplate } from "./types";
import { entryLimit, extraSkills, validateSelection, type OffreLike, type Selection } from "./select";

const TOOL: StructuredTool = {
  name: "select_cv",
  description: "Choisit le cluster, l'intitulé et les puces du CV maître pour l'offre.",
  input_schema: {
    type: "object",
    properties: {
      cluster: { type: "string" },
      headline: { type: "string" },
      bullets: {
        type: "array",
        items: {
          type: "object",
          properties: { entry: { type: "string" }, ids: { type: "array", items: { type: "string" } } },
          required: ["entry", "ids"],
        },
      },
      extra_skills: { type: "array", items: { type: "string" } },
      reason: { type: "string" },
    },
    required: ["cluster", "headline", "bullets", "extra_skills", "reason"],
  },
};

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Catalogue compact du modèle : ce que l'IA a le droit de choisir. */
export function templateCatalogue(t: CvTemplate, offre: OffreLike, lang: DocLang): string {
  const lines: string[] = ["## Clusters"];
  for (const c of t.clusters) {
    const limits = t.sections
      .filter((s) => c.order.includes(s.id))
      .flatMap((s) => s.entries.map((e) => `${e.id} ≤ ${entryLimit(e, c)}`))
      .join(", ");
    lines.push(`- ${c.id} — ${c.name}. Postes : ${c.titles}. Sections : ${c.order.join(" → ")}. Puces max : ${limits}.`);
  }
  lines.push("", "## Entrées et puces (identifiant [clusters] {groupe} : texte)");
  for (const s of t.sections) {
    for (const e of s.entries) {
      lines.push(`### ${e.id} — ${e.heading?.fr ?? "(liste sans titre)"} (section ${s.id}${e.always ? "" : ", facultative"})`);
      for (const b of e.bullets) lines.push(`- ${b.id} [${b.clusters.join(",")}] {${bulletGroup(b)}} : ${clip(b.text.fr, 240)}`);
    }
  }
  const covered = new Set<string>();
  for (const c of t.clusters) for (const k of extraSkills(t, c, offre, lang, undefined, 30)) covered.add(k);
  lines.push("", "## Mots-clés de l'offre déjà couverts par le candidat", covered.size ? [...covered].join(", ") : "(aucun)");
  if (t.instructions) lines.push("", "## Consignes du candidat", t.instructions);
  return lines.join("\n");
}

let _system: string | null = null;

export type AiSelectDeps = { call?: (req: StructuredRequest) => Promise<StructuredResult> };

/** Choix par l'IA, validé règle par règle ; lève une erreur si l'appel échoue (l'appelant se replie). */
export async function aiSelection(t: CvTemplate, offre: OffreLike & { company?: string | null }, lang: DocLang, deps: AiSelectDeps = {}): Promise<Selection> {
  if (!_system) _system = fs.readFileSync(path.join(process.cwd(), "prompts", "select-cv-template.md"), "utf-8");
  const call = deps.call ?? ((req: StructuredRequest) => callStructured(req));
  const res = await call({
    role: "reviewer",
    maxTokens: 1500,
    system: [{ text: _system, cache: true }],
    tool: TOOL,
    user: `${templateCatalogue(t, offre, lang)}

## Offre
- Intitulé : ${offre.title}
- Entreprise : ${offre.company ?? ""}
- Pays : ${offre.country ?? ""}
- Description :
${offre.description_text.slice(0, 6000)}

Choisis le CV pour cette offre.`,
  });
  if (!res.input) throw new Error("réponse vide");
  return validateSelection(t, offre, lang, res.input);
}
