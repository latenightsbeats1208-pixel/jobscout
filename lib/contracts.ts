import { detectVie } from "./vie";

export type ContractCategory = "cdi" | "cdd" | "interim" | "vie" | "stage" | "alternance" | "autre";

export const CONTRACT_LABELS: Record<ContractCategory, string> = {
  cdi: "CDI",
  cdd: "CDD",
  interim: "Intérim",
  vie: "V.I.E",
  stage: "Stage",
  alternance: "Alternance",
  autre: "Autre",
};

export const CONTRACT_ORDER: ContractCategory[] = ["cdi", "cdd", "interim", "vie", "stage", "alternance", "autre"];

function strip(s: string | null | undefined): string {
  if (!s) return "";
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

const ALTERNANCE = /\b(alternance|alternant|apprentissage|apprenti|contrat\s+pro|professionnalisation)\b/;
const STAGE = /\b(stage|stagiaire|internship|intern)\b/;
/**
 * « STG - Assistant(e) Acheteur » (Printemps, 19 octobre 2026) : l'abréviation
 * n'est lue que dans le contrat et le titre, jamais dans la description, où
 * elle désigne aussi le bac STG.
 */
const STAGE_DECLARED = /\b(stage|stagiaire|internship|intern|stg)\b/;
const CDI = /\bcdi\b|\bpermanent\b|\bcontrat\s+a\s+duree\s+indeterminee\b/;
const CDD = /\bcdd\b|\bfixed[\s-]term\b|\btemporary\b|\btemporaire\b|\bsaisonnier\b|\bcontrat\s+a\s+duree\s+determinee\b/;
// « Intérim », « Mission intérimaire », « Travail temporaire » : le contrat déclaré.
const INTERIM = /\b(interim|interimaire|travail\s+temporaire)\b/;
// Dans une description, seule une mission désigne l'intérim : les agences signent
// toutes leurs annonces, CDI compris, de « travail temporaire et recrutement en
// CDD et CDI » (constaté sur Team Emploi, SIM, Partnaire… octobre 2026).
const INTERIM_MISSION = /\b(mission|contrat|poste)s?\s+(d\s*'?\s*|en\s+|de\s+)?interim(aire)?\b/;
// Une alternance est un CDD en droit : « CDD - 24 Mois - Contrat apprentissage ».
const ALTERNANCE_CONTRACT = /\bcontrat\s+(d\s*'?\s*)?(apprentissage|professionnalisation)\b|\ben\s+alternance\b|\bcontrat\s+pro\b/;

/** Contrat lu dans un libellé court : champ contrat de la source, ou titre. */
function declaredCategory(text: string): ContractCategory | null {
  if (!text.trim()) return null;
  if (CDI.test(text)) return "cdi"; // « CDI intérimaire » est un CDI
  if (INTERIM.test(text)) return "interim";
  if (CDD.test(text)) return "cdd";
  return null;
}

export function classifyContract(input: {
  contract_type: string | null;
  title: string;
  description_text: string;
  is_vie?: number | boolean; // legacy, ignored — we re-detect on the fly
  source?: string | null;
  url?: string | null;
}): ContractCategory {
  // 1. V.I.E with strict detection (re-evaluated, ignores any stale is_vie flag).
  //    We check this BEFORE alternance/stage so "V.I.E Marketing" is V.I.E, not "stage".
  if (
    detectVie({
      source: input.source ?? "",
      title: input.title,
      description: input.description_text,
      url: input.url,
    })
  ) {
    return "vie";
  }

  const ct = strip(input.contract_type);
  const title = strip(input.title);
  const description = strip(input.description_text).slice(0, 1500);

  // 2. Ce que l'offre déclare — champ contrat de la source, puis titre — passe
  //    avant la description, qui cite aussi d'autres contrats que le sien
  //    (« vous encadrerez un stagiaire », « recrutement en CDD et CDI »).
  const declared = `${ct} ${title}`;
  if (ALTERNANCE.test(declared)) return "alternance";
  if (STAGE_DECLARED.test(declared)) return "stage";
  const stated = declaredCategory(ct) ?? declaredCategory(title);
  if (stated === "cdd" && ALTERNANCE_CONTRACT.test(description)) return "alternance";
  if (stated) return stated;

  // 3. Contrat non déclaré : la description.
  if (ALTERNANCE.test(description)) return "alternance";
  if (STAGE.test(description)) return "stage";
  if (INTERIM_MISSION.test(description)) return "interim";
  const cdd = CDD.test(description);
  const cdi = CDI.test(description);
  // Les deux à la fois : « en CDD ou CDI », formule d'agence, ne tranche rien.
  if (cdd !== cdi) return cdd ? "cdd" : "cdi";

  // 4. JSON-LD employmentType fallback
  if (ct.includes("intern")) return "stage";
  if (ct.includes("temporary") || ct.includes("contractor")) return "cdd";
  if (ct.includes("full_time") || ct.includes("part_time") || ct.includes("full time") || ct.includes("part time")) {
    return "cdi";
  }

  return "autre";
}
