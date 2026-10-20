import { describe, expect, it } from "vitest";
import { scoreDisplay, scoreScale } from "@/lib/utils";

/**
 * « Excellent » dès 80, « Bon » dès 60 : sur les 8 CV de l'audit d'octobre
 * 2026, l'offre parfaite d'une jeune diplômée valait 51 (« Moyen »), un
 * hors-sujet proposé à un enseignant 76 (« Bon »), un poste inaccessible de
 * chef d'équipe SSIAP 2 83 (« Excellent »). Le libellé dit désormais la place
 * de l'offre dans la liste de la personne, ou le verdict de l'IA.
 */

// Liste de la jeune diplômée : ses meilleures notes plafonnent autour de 50.
const junior = scoreScale([51, 45, 36, 35, 34, 33, 32, 31, 31, 30, 28, 27, 26, 26, 25, 24, 24, 20, 18, 12]);

describe("ce que la note veut dire pour la personne", () => {
  it("place l'offre dans la liste de la personne, quelle que soit l'échelle de son métier", () => {
    expect(junior).toEqual({ best: 45, high: 33, middle: 27 });
    expect(scoreDisplay(51, { scale: junior }).label).toBe("Parmi vos meilleures offres");
    expect(scoreDisplay(33, { scale: junior })).toMatchObject({ tone: "bon", label: "Haut de votre liste" });
    expect(scoreDisplay(27, { scale: junior }).tone).toBe("moyen");
    expect(scoreDisplay(12, { scale: junior }).label).toBe("Bas de votre liste");
  });

  it("le verdict de l'IA l'emporte sur le rang, une exclusion sur tout", () => {
    expect(scoreDisplay(83, { scale: junior, verdict: "hors_profil" })).toMatchObject({ tone: "faible", label: "Relue par l'IA : hors profil" });
    expect(scoreDisplay(40, { scale: junior, verdict: "postuler" }).tone).toBe("excellent");
    expect(scoreDisplay(51, { scale: junior, verdict: "postuler", excluded: true }).label).toBe("Hors de vos critères");
  });

  it("sous 10 offres, un rang ne dit rien : l'échelle fixe reste", () => {
    expect(scoreScale([80, 60, 40])).toBeNull();
    expect(scoreDisplay(62, { scale: null }).label).toBe("Bon");
  });
});
