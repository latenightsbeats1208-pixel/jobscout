import { detectVie } from "./vie";

export type ContractCategory = "cdi" | "cdd" | "vie" | "stage" | "alternance" | "autre";

export const CONTRACT_LABELS: Record<ContractCategory, string> = {
  cdi: "CDI",
  cdd: "CDD",
  vie: "V.I.E",
  stage: "Stage",
  alternance: "Alternance",
  autre: "Autre",
};

export const CONTRACT_ORDER: ContractCategory[] = ["cdi", "cdd", "vie", "stage", "alternance", "autre"];

function strip(s: string | null | undefined): string {
  if (!s) return "";
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
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

  const haystack = `${strip(input.contract_type)} ${strip(input.title)} ${strip(input.description_text).slice(0, 1500)}`;

  // 2. Alternance / apprentissage (very specific keywords)
  if (/\b(alternance|alternant|apprentissage|apprenti|contrat\s+pro|professionnalisation)\b/.test(haystack)) {
    return "alternance";
  }
  // 3. Stage / internship
  if (/\b(stage|stagiaire|internship|intern)\b/.test(haystack)) {
    return "stage";
  }
  // 4. CDD
  if (/\bcdd\b|\bfixed[\s-]term\b|\btemporary\b|\btemporaire\b|\bcontrat\s+a\s+duree\s+determinee\b/.test(haystack)) {
    return "cdd";
  }
  // 5. CDI
  if (/\bcdi\b|\bpermanent\b|\bcontrat\s+a\s+duree\s+indeterminee\b/.test(haystack)) {
    return "cdi";
  }

  // 6. JSON-LD employmentType fallback
  const ct = strip(input.contract_type);
  if (ct.includes("intern")) return "stage";
  if (ct.includes("temporary") || ct.includes("contractor")) return "cdd";
  if (ct.includes("full_time") || ct.includes("part_time") || ct.includes("full time") || ct.includes("part time")) {
    return "cdi";
  }

  return "autre";
}
