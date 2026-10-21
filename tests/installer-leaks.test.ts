import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { checkLeaks, ciMasking, homeDirNeedles, mask } from "@/installer/check-leaks.mjs";

// Anti-fuite (installer/check-leaks.mjs) : exécutables reconnus par leur
// contenu, fichiers interdits de macOS et de la signature Apple, termes
// supplémentaires (dossier personnel de la machine de build) et masquage des
// résultats dans les journaux publics de GitHub Actions.

const EMAIL = "marie.durand@example.org";
const PHONE = "06 12 34 56 78";

/** En-tête Mach-O 64 bits little-endian (arm64), suivi de `extra`. */
function machO(extra: string): Buffer {
  const b = Buffer.alloc(32);
  b.writeUInt32LE(0xfeedfacf, 0);
  b.writeUInt32LE(0x0100000c, 4);
  b.writeUInt32LE(2, 12);
  return Buffer.concat([b, Buffer.from(extra, "latin1")]);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "jobscout-leaks-"));
const pkg = path.join(tmp, "pkg");
const put = (rel: string, data: Buffer | string) => {
  const p = path.join(pkg, ...rel.split("/"));
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, data);
};

put("notes.txt", `Appelez le ${PHONE}.\n`);
put("MacOS/node", machO(`\u0000${PHONE}\u0000contact ${EMAIL}\u0000`));
put("MacOS/JobScout", machO("\u0000lanceur\u0000"));
put("vendor/Lib.class", (() => {
  const c = Buffer.alloc(16);
  c.writeUInt32BE(0xcafebabe, 0);
  c.writeUInt32BE(52, 4);
  return Buffer.concat([c, Buffer.from(` ${PHONE} `, "latin1")]);
})());
put("Frameworks/libx.dylib", `texte ${PHONE} texte`);
put(`docs/${EMAIL}.txt`, "rien de personnel ici\n");

const FORBIDDEN = [
  ".DS_Store",
  "Resources/._JobScout.icns",
  "signature/cert.p12",
  "signature/AuthKey_ABC.p8",
  "signature/build.keychain-db",
  "leak-needles.local.txt",
  "leak-needles.ci.txt",
];
for (const f of FORBIDDEN) put(f, "x");

afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

const scan = (opts: { extraNeedles?: Array<string | RegExp>; mask?: boolean } = {}) => {
  const r = checkLeaks([pkg], { verbose: false, ...opts });
  return { ...r, findings: r.findings.map((f) => ({ ...f, file: f.file.replace(/\\/g, "/") })) };
};
const about = (findings: Array<{ file: string; kind: string }>, file: string) =>
  findings.filter((f) => f.file === `pkg/${file}`).map((f) => f.kind);

describe("exécutables reconnus par leur contenu", () => {
  it("Mach-O sans extension : termes cherchés, motifs non appliqués", () => {
    const { findings, executables } = scan({ extraNeedles: [EMAIL], mask: false });
    const kinds = about(findings, "MacOS/node");
    expect(kinds).toContain(`terme « ${EMAIL} » dans le CONTENU`);
    expect(kinds.some((k) => k.startsWith("motif"))).toBe(false);
    expect(about(findings, "MacOS/JobScout")).toEqual([]);
    expect(executables).toBe(2);
  });

  it("texte et classe Java (cafebabe + version) : motifs appliqués", () => {
    const { findings } = scan({ mask: false });
    expect(about(findings, "notes.txt")).toContain("motif : numéro de téléphone (format français)");
    expect(about(findings, "vendor/Lib.class")).toContain("motif : numéro de téléphone (format français)");
  });

  it(".dylib : binaire par son extension, motifs non appliqués", () => {
    const { findings } = scan({ mask: false });
    expect(about(findings, "Frameworks/libx.dylib")).toEqual([]);
  });
});

describe("fichiers interdits (macOS, signature Apple, listes de termes)", () => {
  it.each(FORBIDDEN)("%s", (rel) => {
    const { findings } = scan({ mask: false });
    expect(about(findings, rel)).toContain("fichier interdit dans un paquet");
  });

  it("un nom voisin n'est pas interdit", () => {
    put("ok/DS_Store.md", "x");
    put("ok/a._b.txt", "x");
    put("ok/p8.txt", "x");
    const { findings } = scan({ mask: false });
    for (const rel of ["ok/DS_Store.md", "ok/a._b.txt", "ok/p8.txt"]) {
      expect(about(findings, rel)).not.toContain("fichier interdit dans un paquet");
    }
  });
});

describe("termes supplémentaires (extraNeedles)", () => {
  it("s'ajoutent aux termes recherchés, dans le contenu et dans les noms", () => {
    const base = scan({ mask: false });
    const withExtra = scan({ extraNeedles: [EMAIL, /lanceur/], mask: false });
    expect(withExtra.needleCount).toBe(base.needleCount + 2);
    expect(about(withExtra.findings, `docs/${EMAIL}.txt`)).toContain(`terme « ${EMAIL} » dans le NOM`);
    expect(about(withExtra.findings, "MacOS/JobScout")).toContain("terme « lanceur » dans le CONTENU");
    expect(about(base.findings, `docs/${EMAIL}.txt`)).toEqual([]);
  });

  it("un terme vide ou qui n'est pas une chaîne est refusé", () => {
    expect(() => checkLeaks([pkg], { verbose: false, extraNeedles: ["  "] })).toThrow(/terme supplémentaire invalide/);
    expect(() =>
      checkLeaks([pkg], { verbose: false, extraNeedles: [42] as unknown as string[] })
    ).toThrow(/terme supplémentaire invalide/);
  });
});

describe("homeDirNeedles : formes du dossier personnel", () => {
  it("macOS et Linux : telle quelle et avec les « / » échappés", () => {
    expect(homeDirNeedles("/Users/runner")).toEqual(["/Users/runner", "\\/Users\\/runner"]);
    expect(homeDirNeedles("/home/runner/")).toEqual(["/home/runner", "\\/home\\/runner"]);
  });

  it("Windows : « \\ », « \\\\ » (JSON) et « / »", () => {
    expect(homeDirNeedles("D:\\Profils\\marie")).toEqual([
      "D:\\Profils\\marie",
      "D:\\\\Profils\\\\marie",
      "D:/Profils/marie",
    ]);
  });

  it("racine ou chemin trop court : aucun terme", () => {
    expect(homeDirNeedles("/")).toEqual([]);
    expect(homeDirNeedles("C:\\")).toEqual([]);
    expect(homeDirNeedles("/a")).toEqual([]);
    expect(homeDirNeedles("")).toEqual([]);
  });

  it("le dossier personnel trouvé dans un fichier est signalé", () => {
    put("cache/chemins.json", JSON.stringify({ racine: "/Users/runner/work/projet" }));
    const { findings } = scan({ extraNeedles: homeDirNeedles("/Users/runner"), mask: false });
    expect(about(findings, "cache/chemins.json")).toContain("terme « /Users/runner » dans le CONTENU");
  });
});

describe("masquage des résultats (journaux publics de GitHub Actions)", () => {
  const saved = process.env.GITHUB_ACTIONS;
  afterEach(() => {
    if (saved === undefined) delete process.env.GITHUB_ACTIONS;
    else process.env.GITHUB_ACTIONS = saved;
  });

  it("mask : deux caractères, puis des étoiles", () => {
    expect(mask("abcdef")).toBe("ab****");
    expect(mask("a")).toBe("a*");
    expect(mask(EMAIL)).toBe("ma" + "*".repeat(EMAIL.length - 2));
  });

  it("ciMasking : seulement GITHUB_ACTIONS=true", () => {
    expect(ciMasking({ GITHUB_ACTIONS: "true" })).toBe(true);
    expect(ciMasking({ GITHUB_ACTIONS: "false" })).toBe(false);
    expect(ciMasking({})).toBe(false);
  });

  it("masqué : ni terme, ni extrait, ni segment de nom en clair", () => {
    const { findings } = scan({ extraNeedles: [EMAIL], mask: true });
    const all = JSON.stringify(findings);
    expect(all).not.toContain(EMAIL);
    expect(all).not.toContain(PHONE.slice(0, 8));
    expect(about(findings, "MacOS/node")).toContain(`terme « ${mask(EMAIL)} » dans le CONTENU`);
    expect(findings.some((f) => f.file === `pkg/docs/${mask(`${EMAIL}.txt`)}`)).toBe(true);
    const phone = findings.find((f) => f.file === "pkg/notes.txt" && f.kind.startsWith("motif"));
    expect(phone?.sample).toBe(mask(PHONE.slice(0, 12)) + "…");
  });

  it("en clair hors CI : terme, extrait et nom lisibles", () => {
    const { findings } = scan({ extraNeedles: [EMAIL], mask: false });
    const phone = findings.find((f) => f.file === "pkg/notes.txt" && f.kind.startsWith("motif"));
    expect(phone?.sample).toBe(PHONE.slice(0, 12) + "…");
    expect(findings.some((f) => f.file === `pkg/docs/${EMAIL}.txt`)).toBe(true);
  });

  it("sans option, la variable GITHUB_ACTIONS décide", () => {
    process.env.GITHUB_ACTIONS = "true";
    expect(JSON.stringify(checkLeaks([pkg], { verbose: false, extraNeedles: [EMAIL] }).findings)).not.toContain(EMAIL);
    delete process.env.GITHUB_ACTIONS;
    expect(JSON.stringify(checkLeaks([pkg], { verbose: false, extraNeedles: [EMAIL] }).findings)).toContain(EMAIL);
  });
});
