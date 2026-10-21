import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  HEAD_BYTES,
  MAX_FAT_ARCHS,
  archName,
  binaryKind,
  fileBinaryKind,
  fileMachOArchs,
  findExecutables,
  isExecutableBinary,
  isMachO,
  machOArchs,
} from "@/installer/macho.mjs";

// Détection des exécutables par le CONTENU (installer/macho.mjs) : la garde
// « aucun Mach-O hors MacOS/JobScout et MacOS/node » du build Mac, l'inventaire
// de la recette et l'anti-fuite reposent dessus.

const CPU_X86_64 = 0x01000007;
const CPU_ARM64 = 0x0100000c;

/** En-tête Mach-O 64 bits little-endian (x86_64, arm64), suivi de `extra`. */
function thin64(cpu: number, sub = 0, extra: Buffer = Buffer.alloc(0)): Buffer {
  const b = Buffer.alloc(32);
  b.writeUInt32LE(0xfeedfacf, 0); // octets cf fa ed fe
  b.writeUInt32LE(cpu, 4);
  b.writeUInt32LE(sub, 8);
  b.writeUInt32LE(2, 12); // MH_EXECUTE
  return Buffer.concat([b, extra]);
}

/** En-tête fat (universel), big-endian. */
function fat(archs: Array<[number, number]>, is64 = false): Buffer {
  const entry = is64 ? 32 : 20;
  const b = Buffer.alloc(8 + archs.length * entry);
  b.writeUInt32BE(is64 ? 0xcafebabf : 0xcafebabe, 0);
  b.writeUInt32BE(archs.length, 4);
  archs.forEach(([cpu, sub], i) => {
    b.writeUInt32BE(cpu, 8 + i * entry);
    b.writeUInt32BE(sub, 12 + i * entry);
  });
  return b;
}

/** PE minimal : « MZ », e_lfanew en 0x3c, « PE\0\0 » à cet offset. */
function pe(lfanew = 0x80): Buffer {
  const b = Buffer.alloc(lfanew + 24);
  b.write("MZ", 0, "latin1");
  b.writeUInt32LE(lfanew, 0x3c);
  b.writeUInt32BE(0x50450000, lfanew);
  return b;
}

const elf = (cls = 2) => Buffer.from([0x7f, 0x45, 0x4c, 0x46, cls, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0]);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "jobscout-macho-"));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe("binaryKind : signatures reconnues", () => {
  it("Mach-O fin, 32 et 64 bits, little et big-endian", () => {
    expect(binaryKind(thin64(CPU_ARM64))).toBe("macho");
    const be64 = Buffer.alloc(32);
    be64.writeUInt32BE(0xfeedfacf, 0);
    expect(binaryKind(be64)).toBe("macho");
    const le32 = Buffer.alloc(28);
    le32.writeUInt32LE(0xfeedface, 0);
    expect(binaryKind(le32)).toBe("macho");
    const be32 = Buffer.alloc(28);
    be32.writeUInt32BE(0xfeedface, 0);
    expect(binaryKind(be32)).toBe("macho");
  });

  it("Mach-O fat (universel), fat_arch et fat_arch_64", () => {
    expect(binaryKind(fat([[CPU_X86_64, 3], [CPU_ARM64, 0]]))).toBe("macho-fat");
    expect(binaryKind(fat([[CPU_X86_64, 3], [CPU_ARM64, 0]], true))).toBe("macho-fat");
  });

  it("PE (MZ + PE\\0\\0) et ELF", () => {
    expect(binaryKind(pe())).toBe("pe");
    expect(binaryKind(elf(1))).toBe("elf");
    expect(binaryKind(elf(2))).toBe("elf");
  });

  it("isExecutableBinary et isMachO suivent binaryKind", () => {
    expect(isExecutableBinary(thin64(CPU_X86_64))).toBe(true);
    expect(isExecutableBinary(pe())).toBe(true);
    expect(isMachO(fat([[CPU_ARM64, 0]]))).toBe(true);
    expect(isMachO(pe())).toBe(false);
    expect(isMachO(elf())).toBe(false);
  });
});

describe("binaryKind : aucun faux positif", () => {
  it("classe Java : cafebabe suivi de sa version (45 ou plus), pas un fat", () => {
    for (const major of [45, 52, 65]) {
      const cls = Buffer.alloc(64);
      cls.writeUInt32BE(0xcafebabe, 0);
      cls.writeUInt16BE(0, 4); // minor
      cls.writeUInt16BE(major, 6);
      expect(binaryKind(cls)).toBeNull();
    }
    expect(MAX_FAT_ARCHS).toBeLessThan(45);
  });

  it("fat sans architecture ou au-delà de la borne : refusé", () => {
    const zero = Buffer.alloc(8);
    zero.writeUInt32BE(0xcafebabe, 0);
    expect(binaryKind(zero)).toBeNull();
    const many = Buffer.alloc(8);
    many.writeUInt32BE(0xcafebabe, 0);
    many.writeUInt32BE(MAX_FAT_ARCHS + 1, 4);
    expect(binaryKind(many)).toBeNull();
  });

  it("un texte qui commence par « MZ » n'est pas un PE", () => {
    const text = Buffer.from("MZ est un texte ordinaire, sans en-tête PE derrière. ".repeat(4), "utf-8");
    expect(binaryKind(text)).toBeNull();
  });

  it("textes, JSON, PNG, UTF-8 accentué, fichiers trop courts : rien", () => {
    expect(binaryKind(Buffer.from('{"version":"3.4.18"}'))).toBeNull();
    expect(binaryKind(Buffer.from("module.exports = 1;\n"))).toBeNull();
    expect(binaryKind(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBeNull();
    expect(binaryKind(Buffer.from("Ώρα, élan, être", "utf-8"))).toBeNull(); // commence par ce 8f
    expect(binaryKind(Buffer.from([0xcf, 0xfa, 0xed]))).toBeNull();
    expect(binaryKind(Buffer.alloc(0))).toBeNull();
    expect(binaryKind(null)).toBeNull();
    expect(binaryKind(thin64(CPU_ARM64).subarray(0, 12))).toBeNull(); // en-tête tronqué
    expect(binaryKind(elf(3))).toBeNull(); // classe ELF inconnue
  });
});

describe("machOArchs : architectures comme lipo -archs", () => {
  it("Mach-O fin", () => {
    expect(machOArchs(thin64(CPU_X86_64, 3))).toEqual(["x86_64"]);
    expect(machOArchs(thin64(CPU_ARM64, 0))).toEqual(["arm64"]);
    // arm64e : sous-type 2, bits de capacités ignorés.
    expect(machOArchs(thin64(CPU_ARM64, 0x80000002))).toEqual(["arm64e"]);
  });

  it("universel, dans l'ordre du fichier", () => {
    expect(machOArchs(fat([[CPU_X86_64, 3], [CPU_ARM64, 0]]))).toEqual(["x86_64", "arm64"]);
    expect(machOArchs(fat([[CPU_ARM64, 0], [CPU_X86_64, 3]], true))).toEqual(["arm64", "x86_64"]);
  });

  it("en-tête fat tronqué ou fichier non Mach-O : null", () => {
    const cut = fat([[CPU_X86_64, 3], [CPU_ARM64, 0]]).subarray(0, 8 + 20);
    expect(machOArchs(cut)).toBeNull();
    expect(machOArchs(pe())).toBeNull();
    expect(machOArchs(Buffer.from("texte"))).toBeNull();
  });

  it("archName : noms connus, et repli lisible", () => {
    expect(archName(CPU_X86_64, 8)).toBe("x86_64h");
    expect(archName(7, 3)).toBe("i386");
    expect(archName(0x01000012)).toBe("ppc64");
    expect(archName(0x0200000c)).toBe("arm64_32");
    expect(archName(0x99)).toBe("cpu-0x99");
  });
});

describe("fichiers sur disque", () => {
  it("le node qui exécute ces tests est reconnu selon son système", () => {
    const kind = fileBinaryKind(process.execPath);
    const expected: Record<string, string[]> = {
      win32: ["pe"],
      darwin: ["macho", "macho-fat"],
      linux: ["elf"],
    };
    if (expected[process.platform]) expect(expected[process.platform]).toContain(kind);
    else expect(kind).not.toBeNull();
    if (process.platform === "darwin") {
      expect(fileMachOArchs(process.execPath)).toContain(process.arch === "arm64" ? "arm64" : "x86_64");
    }
  });

  it("PE dont l'en-tête est au-delà des premiers Ko : même verdict que sur le fichier entier", () => {
    const far = pe(HEAD_BYTES * 2);
    const file = path.join(tmp, "far.bin");
    fs.writeFileSync(file, far);
    expect(binaryKind(far)).toBe("pe");
    expect(binaryKind(far.subarray(0, HEAD_BYTES))).toBeNull();
    expect(fileBinaryKind(file)).toBe("pe");
    // Offset qui pointe au-delà de la fin du fichier : rien.
    const broken = Buffer.from(far.subarray(0, 0x40));
    const brokenFile = path.join(tmp, "broken.bin");
    fs.writeFileSync(brokenFile, broken);
    expect(fileBinaryKind(brokenFile)).toBeNull();
  });

  it("findExecutables : inventaire par le contenu, chemins « / » triés, liens ignorés", () => {
    const root = path.join(tmp, "JobScout.app", "Contents");
    const put = (rel: string, data: Buffer | string) => {
      const p = path.join(root, ...rel.split("/"));
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, data);
    };
    put("MacOS/JobScout", fat([[CPU_X86_64, 3], [CPU_ARM64, 0]]));
    put("MacOS/node", thin64(CPU_ARM64, 0, Buffer.alloc(64)));
    put("Resources/app/server.js", "require('next');\n");
    put("Resources/app/node_modules/x/lib/addon.node", thin64(CPU_X86_64, 3)); // extension trompeuse
    put("Resources/app/vendor/Lib.class", (() => {
      const c = Buffer.alloc(16);
      c.writeUInt32BE(0xcafebabe, 0);
      c.writeUInt32BE(52, 4);
      return c;
    })());
    put("Resources/win/tool.dll", pe());
    put("Resources/elf/sans-extension", elf());
    try {
      fs.symlinkSync("node", path.join(root, "MacOS", "lien-vers-node"));
    } catch {
      /* liens non autorisés (Windows sans mode développeur) : sans objet */
    }

    const all = findExecutables(root);
    expect(all.map((e) => [e.path, e.kind])).toEqual([
      ["MacOS/JobScout", "macho-fat"],
      ["MacOS/node", "macho"],
      ["Resources/app/node_modules/x/lib/addon.node", "macho"],
      ["Resources/elf/sans-extension", "elf"],
      ["Resources/win/tool.dll", "pe"],
    ]);
    expect(all[0].archs).toEqual(["x86_64", "arm64"]);
    expect(all[1].archs).toEqual(["arm64"]);
    expect(all[3].archs).toBeNull();

    const macho = findExecutables(root, { kinds: ["macho", "macho-fat"] }).map((e) => e.path);
    expect(macho).toEqual(["MacOS/JobScout", "MacOS/node", "Resources/app/node_modules/x/lib/addon.node"]);
  });
});
