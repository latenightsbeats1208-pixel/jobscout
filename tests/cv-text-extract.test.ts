import { describe, expect, it } from "vitest";
import { preferStructuredPdfText } from "@/lib/cv/text-extract";

const words = (n: number, word = "mot") => Array.from({ length: n }, () => word).join(" ");

describe("choix de la lecture d'un PDF", () => {
  it("pdfjs nettement plus riche → pdfjs", () => {
    const fast = `Expérience ${words(100)}`;
    const structured = `Expérience Formation ${words(200)}`;
    expect(preferStructuredPdfText(fast, structured)).toBe(true);
  });

  it("écart faible → pdf-parse", () => {
    const fast = `Expérience ${words(200)}`;
    const structured = `Expérience ${words(205)}`;
    expect(preferStructuredPdfText(fast, structured)).toBe(false);
  });

  it("titres découpés lettre par lettre (PDF Canva) → pdf-parse, malgré plus de « mots » côté pdfjs", () => {
    const fast = `EXPÉRIENCE FORMATION COMPÉTENCES ${words(200)}`;
    const structured = `E X P É R I E N C E F O R M A T I O N C O M P É T E N C E S ${words(280)}`;
    expect(preferStructuredPdfText(fast, structured)).toBe(false);
  });

  it("pdf-parse vide (PDF multi-colonnes mal lu) → pdfjs", () => {
    expect(preferStructuredPdfText("", `Expérience ${words(80)}`)).toBe(true);
  });
});
