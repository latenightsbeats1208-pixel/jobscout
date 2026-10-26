import "server-only";
import { getLlmConfig } from "@/lib/ai/client";
import { renderTemplateCvDocx } from "@/lib/docx/template-cv";
import type { DocLang } from "@/lib/text/lang";
import { aiSelection, type AiSelectDeps } from "./ai-select";
import { assembleTemplateCv, type TemplateCvDoc } from "./assemble";
import { fitTemplateCvToOnePage } from "./render";
import { autoSelection, type OffreLike, type Selection } from "./select";
import type { CvTemplate } from "./types";

export type TemplateCvResult = { doc: TemplateCvDoc; selection: Selection; pdf: Buffer; docx: Buffer };

/** Choix par l'IA si elle est configurée, sinon (ou en cas d'échec) choix automatique. */
export async function chooseSelection(
  t: CvTemplate,
  offre: OffreLike & { company?: string | null },
  lang: DocLang,
  deps: AiSelectDeps & { aiConfigured?: boolean } = {}
): Promise<{ selection: Selection; notice: string | null }> {
  const aiConfigured = deps.aiConfigured ?? getLlmConfig().mode !== "unset";
  if (!aiConfigured) return { selection: autoSelection(t, offre, lang), notice: null };
  try {
    return { selection: await aiSelection(t, offre, lang, deps), notice: null };
  } catch (e) {
    console.log(`[cv-template] choix IA impossible, choix automatique : ${e instanceof Error ? e.message : String(e)}`);
    return { selection: autoSelection(t, offre, lang), notice: "Choix automatique des puces (l'IA n'a pas répondu)." };
  }
}

export async function generateTemplateCv(
  t: CvTemplate,
  offre: OffreLike & { company?: string | null },
  lang: DocLang,
  deps: AiSelectDeps & { aiConfigured?: boolean } = {}
): Promise<TemplateCvResult> {
  const { selection, notice } = await chooseSelection(t, offre, lang, deps);
  const assembled = assembleTemplateCv(t, selection, offre, lang);
  if (notice) assembled.warnings.unshift(notice);
  const { pdf, doc } = await fitTemplateCvToOnePage(assembled);
  const docx = await renderTemplateCvDocx(doc);
  return { doc, selection, pdf, docx };
}
