import { describe, expect, it } from "vitest";
import { scoreAts } from "@/lib/ats/score";

const GOOD_CV = `
Marie Dupont
marie.dupont@email.com · +33 6 12 34 56 78 ·linkedin.com/in/marie-dupont · Paris, France

PROFILE
Développeuse Full-Stack spécialisée Python et React.

EXPERIENCES
Développeuse Full-Stack — TechCorp, Paris · Janv. 2022 – Mars 2024
• Développé une application React utilisée par 40 000 utilisateurs
• Conçu une API Python traitant 2 M de requêtes par jour
• Optimisé le temps de chargement de 35 %

Stage Développeur — StartupXYZ · 01/2021 – 12/2021
• Implémenté des tests automatisés
• Amélioré le pipeline CI

EDUCATION
Master Informatique — Université Paris-Saclay, 2018 – 2020
Licence Informatique — Université Paris-Diderot, 2015 – 2018

SKILLS
Python, React, TypeScript, Docker, PostgreSQL, tests automatisés, CI
`;

describe("scoreAts", () => {
  it("donne un score élevé à un CV bien structuré avec titre cible", () => {
    const r = scoreAts(GOOD_CV, "Développeur Full-Stack");
    const pct = r.score / r.max;
    expect(pct).toBeGreaterThanOrEqual(0.85);
    expect(r.grade).toBe("excellent");
    const kw = r.criteria.find((c) => c.id === "keywords");
    expect(kw?.ok).toBe(true);
    expect(r.criteria.find((c) => c.id === "contact_email")?.ok).toBe(true);
    expect(r.criteria.find((c) => c.id === "contact_phone")?.ok).toBe(true);
    expect(r.criteria.find((c) => c.id === "section_experience")?.ok).toBe(true);
    expect(r.criteria.find((c) => c.id === "dates")?.ok).toBe(true);
    expect(r.criteria.find((c) => c.id === "bullets")?.ok).toBe(true);
    expect(r.criteria.find((c) => c.id === "parseable")?.ok).toBe(true);
  });

  it("fait ressortir les manques d'un CV vide", () => {
    const r = scoreAts("Curriculum vitae de Jean.");
    expect(r.grade).toBe("faible");
    expect(r.score).toBeLessThanOrEqual(r.max * 0.4);
    expect(r.suggestions.length).toBeGreaterThan(3);
    const email = r.criteria.find((c) => c.id === "contact_email");
    expect(email?.ok).toBe(false);
    expect(email?.points).toBe(0);
    expect(r.suggestions.some((s) => s.criterion === "contact_email" && s.gain > 0)).toBe(true);
  });

  it("laisse le critère mots-clés neutre (0 pts) sans titre cible", () => {
    const r = scoreAts(GOOD_CV, null);
    const kw = r.criteria.find((c) => c.id === "keywords");
    expect(kw?.max).toBe(0);
    expect(kw?.points).toBe(0);
    // Les autres critères restent notés sur le même barème de base.
    expect(r.max).toBeLessThan(scoreAts(GOOD_CV, "Dev").max);
  });

  it("signale un CV image/PDF scanné (texte quasi vide) comme non extractible", () => {
    const r = scoreAts("     ", null);
    const p = r.criteria.find((c) => c.id === "parseable");
    expect(p?.ok).toBe(false);
    expect(r.suggestions.some((s) => s.criterion === "parseable")).toBe(true);
  });

  it("pénalise un CV sans les mots-clés du poste visé", () => {
    const r = scoreAts(GOOD_CV, "Contrôleur de gestion financier");
    const kw = r.criteria.find((c) => c.id === "keywords");
    expect(kw?.ok).toBe(false);
    expect(kw?.points).toBe(0);
    const s = r.suggestions.find((x) => x.criterion === "keywords");
    expect(s?.gain).toBe(20);
  });

  it("trie les suggestions par gain décroissant", () => {
    const r = scoreAts("Jean. curriculum", "Chef de projet digital");
    const gains = r.suggestions.map((s) => s.gain);
    expect(gains).toEqual([...gains].sort((a, b) => b - a));
  });

  it("reconnaît un numéro canadien et un lien LinkedIn", () => {
    const cv = `
      Contact: jean@email.com, +1 514 555 0101, linkedin.com/in/jean-test
      Experience: gestion de projets depuis Mars 2020
      Skills: gestion
      • piloté une équipe
      • développé un outil
      • amélioré le processus
      Education: Bachelor 2015
    `;
    const r = scoreAts(cv);
    expect(r.criteria.find((c) => c.id === "contact_phone")?.ok).toBe(true);
    expect(r.criteria.find((c) => c.id === "linkedin")?.ok).toBe(true);
  });
});
