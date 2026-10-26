import type { CvTemplate } from "@/lib/cvtemplate/types";
import { parseCvTemplate } from "@/lib/cvtemplate/types";

/** Modèle maître fictif (structure identique à un vrai modèle). */
export const RAW_TEMPLATE = {
  version: 1,
  identity: {
    full_name: "Camille Martin",
    contact: ["+33 6 00 00 00 00", "camille@example.com", "github.com/camille"],
    taglines: [
      { countries: ["CH"], text: { fr: "Citoyenne UE, éligible au permis B", en: "EU citizen, eligible for B permit" } },
      { countries: [], text: { fr: "Disponible en mars 2027", en: "Available March 2027" } },
    ],
  },
  clusters: [
    {
      id: "AI",
      name: "AI engineering",
      titles: "AI Engineer, Ingénieur IA",
      keywords: ["LLM", "IA générative", "RAG"],
      headline: { fr: "Ingénieure IA", en: "AI Engineer" },
      profile: { fr: "Ingénieure IA, LLM en production.", en: "AI engineer, LLMs in production." },
      order: ["experience", "projects"],
      priority: ["W1-AI"],
      limits: {},
      skills: {
        fr: [{ label: "IA", items: "intégration de LLM (LLM integration), Python" }],
        en: [{ label: "AI", items: "LLM integration, Python" }],
      },
    },
    {
      id: "EMB",
      name: "Embedded",
      titles: "Embedded Engineer, Ingénieur embarqué",
      keywords: ["embarqué", "firmware", "Yocto", "CAN"],
      headline: { fr: "Ingénieure embarqué", en: "Embedded Engineer" },
      profile: { fr: "Ingénieure embarqué, Linux et CAN.", en: "" },
      order: ["projects", "experience"],
      priority: [],
      limits: { side: 1 },
      skills: { fr: [{ label: "Embarqué", items: "C++, Yocto, CAN, Docker" }], en: [] },
    },
  ],
  sections: [
    {
      id: "experience",
      title: { fr: "Expérience", en: "Experience" },
      entries: [
        {
          id: "work",
          heading: { fr: "Stagiaire — Acme", en: "Intern — Acme" },
          meta: { fr: "2026 – présent", en: "2026 – present" },
          min_bullets: 2,
          max_bullets: 2,
          bullets: [
            { id: "W1-AI", clusters: ["AI"], text: { fr: "Pipeline LLM sur [N] demandes", en: "LLM pipeline on [N] requests" } },
            { id: "W1-EMB", clusters: ["EMB"], text: { fr: "Outil CAN généré par LLM", en: "LLM-generated CAN tool" } },
            { id: "W2", clusters: ["AI", "EMB"], text: { fr: "Analyse de séries temporelles", en: "Time series analysis" } },
            { id: "W3", clusters: ["EMB"], text: { fr: "Banc de test", en: "Test bench" } },
          ],
        },
      ],
    },
    {
      id: "projects",
      title: { fr: "Projets", en: "Projects" },
      entries: [
        {
          id: "side",
          heading: { fr: "Projet perso", en: "Side project" },
          max_bullets: 3,
          bullets: [
            { id: "P1", clusters: ["AI"], text: { fr: "Garde-fous LLM", en: "LLM guardrails" } },
            { id: "P2", clusters: ["EMB"], text: { fr: "Firmware ESP32", en: "ESP32 firmware" } },
            { id: "P3", clusters: ["EMB", "AI"], text: { fr: "Honeypot", en: "Honeypot" } },
            { id: "PALL", clusters: ["*"], text: { fr: "Autres : ESP32, honeypot", en: "Other: ESP32, honeypot" }, covers: ["P2", "P3"] },
          ],
        },
        {
          id: "only-ai",
          heading: { fr: "Hackathon IA", en: "AI hackathon" },
          always: false,
          bullets: [{ id: "H1", clusters: ["AI"], text: { fr: "Agent RAG", en: "RAG agent" } }],
        },
      ],
    },
  ],
  education: [{ heading: { fr: "École — Ingénieur", en: "School — Engineering" }, meta: { fr: "2022 – 2027", en: "2022 – 2027" } }],
  extra_keywords: ["Kubernetes"],
};

export function fixtureTemplate(): CvTemplate {
  const r = parseCvTemplate(structuredClone(RAW_TEMPLATE));
  if (!r.ok) throw new Error(r.errors.join("; "));
  return r.template;
}
