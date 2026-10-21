import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Modèles OCR (3.4.18) : tesseract.js écrit `<cachePath>/<langue>.traineddata`,
 * et `./<langue>.traineddata` sans cachePath, c'est-à-dire dans le dossier de
 * lancement du serveur : l'application installée (JobScout.app, Program Files).
 * Ils doivent aller dans le sous-dossier `ocr` du dossier de données, créé au
 * besoin (tesseract.js n'écrit que dans un dossier existant).
 */
const recognize = vi.fn(async (_image: unknown, _langs: string, _options?: { cachePath?: string }) => ({
  data: { text: "Expérience Formation Compétences" },
}));

vi.mock("tesseract.js", () => ({ recognize, default: { recognize } }));

// En-tête PNG : detectFileKind() le classe en « image », donc en OCR.
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

describe("cachePath des modèles OCR", () => {
  const saved = process.env.JOBSCOUT_DATA_DIR;
  let dataDir: string;

  beforeEach(() => {
    recognize.mockClear();
    // Dossier de données qui n'existe pas encore, deux niveaux sous un dossier temporaire.
    dataDir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "jobscout-ocr-")), "Application Support", "JobScout");
    process.env.JOBSCOUT_DATA_DIR = dataDir;
  });

  afterEach(() => {
    if (saved === undefined) delete process.env.JOBSCOUT_DATA_DIR;
    else process.env.JOBSCOUT_DATA_DIR = saved;
  });

  it("une image passe par tesseract avec cachePath = <dossier de données>/ocr, créé au besoin", async () => {
    const { extractText } = await import("@/lib/cv/text-extract");
    const expected = path.join(dataDir, "ocr");
    expect(fs.existsSync(expected)).toBe(false);

    const result = await extractText(PNG, "cv.png");

    expect(result.kind).toBe("image");
    expect(result.strategy).toBe("tesseract");
    expect(recognize).toHaveBeenCalledTimes(1);
    const [, langs, options] = recognize.mock.calls[0];
    expect(langs).toBe("fra+eng");
    expect(options?.cachePath).toBe(expected);
    expect(fs.statSync(expected).isDirectory()).toBe(true);
  });

  it("le dossier des modèles n'est jamais le dossier de lancement du serveur", async () => {
    const { ocrCacheDir } = await import("@/lib/cv/text-extract");
    const dir = ocrCacheDir();
    expect(dir).toBe(path.join(dataDir, "ocr"));
    const launchDir = path.resolve(process.cwd());
    expect(path.resolve(dir)).not.toBe(launchDir);
    expect(path.resolve(dir).startsWith(launchDir + path.sep)).toBe(false);
  });

  it("un fichier texte ne crée pas le dossier des modèles", async () => {
    const { extractText } = await import("@/lib/cv/text-extract");
    const result = await extractText(Buffer.from("Experience\nFormation\nSkills\n", "utf8"), "cv.txt");
    expect(result.kind).toBe("txt");
    expect(recognize).not.toHaveBeenCalled();
    expect(fs.existsSync(path.join(dataDir, "ocr"))).toBe(false);
  });
});
