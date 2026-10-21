// Paquet Mac : configuration (mac.json, Info.plist, droits, épinglage de Node),
// textes du DMG, cohérence des liens de la documentation, et fonctions pures de
// la chaîne de construction. Tout tourne sous Windows, Linux et macOS : rien ici
// n'appelle un outil d'Apple (plutil, codesign, lipo…), qui ne servent qu'en CI.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import {
  FORBIDDEN_INFO_KEYS,
  PKGINFO,
  REQUIRED_APP_FILES,
  appContentProblems,
  escapeXml,
  expectedBundleLayout,
  findExecutableBinaries,
  infoPlistDict,
  infoPlistXml,
  inspectTree,
  loadMacConfig,
  macConfigProblems,
  parseVtoolMinos,
  plistXml,
  readProjectVersion,
  treeProblems,
  versionAtMost,
} from "../installer/mac/bundle.mjs";
import { archiveName, checkPinsAligned, parseShasums, readPins } from "../installer/mac/fetch-node-mac.mjs";
import { ICONSET, encodePng, icnsHeaderProblems, loadRender, unpremultiply, writeIconset } from "../installer/mac/make-icns.mjs";
import { parseShasumLine, renderReadme, sumsLine } from "../installer/mac/make-dmg.mjs";
import {
  ALLOW_JIT,
  ALLOW_UNSIGNED_MEMORY,
  JIT_SCRIPT,
  REHEARSAL_VARIANTS,
  SIGNING_SECRETS,
  codesignDetails,
  macSigningMode,
  parseIdentities,
} from "../installer/mac/sign-mac.mjs";
import { buildMachineNeedles, parseArgs } from "../installer/mac/build-mac.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
// Fins de ligne ramenées à « \n » : sous Windows, la CI extrait le dépôt en
// « \r\n » (core.autocrlf), ce qui casserait la relecture stricte des plists.
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf-8").replace(/\r\n/g, "\n");
const cfg = loadMacConfig();

const temps: string[] = [];
const tempDir = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "jobscout-mac-test-"));
  temps.push(d);
  return d;
};
afterAll(() => {
  for (const d of temps) fs.rmSync(d, { recursive: true, force: true });
});

// ----------------------------------------------------- plist (relecture)
/** Lecteur minimal des plists XML qu'écrit plistXml : relecture indépendante. */
function parsePlist(xml: string): unknown {
  const head = /^<\?xml version="1\.0" encoding="UTF-8"\?>\n<!DOCTYPE plist PUBLIC "-\/\/Apple\/\/DTD PLIST 1\.0\/\/EN" "http:\/\/www\.apple\.com\/DTDs\/PropertyList-1\.0\.dtd">\n<plist version="1\.0">\n/;
  if (!head.test(xml)) throw new Error("en-tête plist inattendu");
  const body = xml.replace(head, "").replace(/\n<\/plist>\n$/, "");
  let i = 0;
  const ws = () => {
    while (i < body.length && /\s/.test(body[i])) i++;
  };
  const text = (close: string) => {
    const j = body.indexOf(close, i);
    if (j < 0) throw new Error(`fermeture ${close} absente`);
    const raw = body.slice(i, j);
    i = j + close.length;
    if (raw.includes("<") || /&(?!amp;|lt;|gt;)/.test(raw)) throw new Error(`texte mal échappé : ${raw}`);
    return raw.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
  };
  const take = (s: string) => {
    if (!body.startsWith(s, i)) return false;
    i += s.length;
    return true;
  };
  const value = (): unknown => {
    ws();
    if (take("<string>")) return text("</string>");
    if (take("<integer>")) return Number(text("</integer>"));
    if (take("<true/>")) return true;
    if (take("<false/>")) return false;
    if (take("<dict/>")) return {};
    if (take("<array/>")) return [];
    if (take("<array>")) {
      const a: unknown[] = [];
      for (;;) {
        ws();
        if (take("</array>")) return a;
        a.push(value());
      }
    }
    if (take("<dict>")) {
      const o: Record<string, unknown> = {};
      for (;;) {
        ws();
        if (take("</dict>")) return o;
        if (!take("<key>")) throw new Error(`clé attendue : ${body.slice(i, i + 40)}`);
        const k = text("</key>");
        o[k] = value();
      }
    }
    throw new Error(`valeur inattendue : ${body.slice(i, i + 40)}`);
  };
  const v = value();
  ws();
  if (i !== body.length) throw new Error(`contenu après la racine : ${body.slice(i, i + 40)}`);
  return v;
}

// ----------------------------------------------------------------- mac.json
describe("mac.json", () => {
  const checkTs = read("lib/update/check.ts");
  const prefix = /const ALLOWED_DOWNLOAD_PREFIX = "([^"]+)"/.exec(checkTs)?.[1] ?? "";
  const repo = prefix.replace(/releases\/$/, "");

  it("décisions figées : identifiant, noms, macOS minimum, ports, fichiers livrés", () => {
    expect(macConfigProblems(cfg)).toEqual([]);
    expect(cfg.bundleIdentifier).toBe("fr.jobscout.app");
    expect([cfg.bundleName, cfg.displayName, cfg.executableName, cfg.iconName, cfg.dataDirName]).toEqual([
      "JobScout", "JobScout", "JobScout", "JobScout", "JobScout",
    ]);
    expect(cfg.minimumSystemVersion).toBe("11.0");
    expect(cfg.ports).toEqual({ first: 3477, last: 3500 });
    expect([cfg.dmgName, cfg.sumsName, cfg.reportName]).toEqual(["JobScout-Mac.dmg", "SHA256SUMS.txt", "rapport-construction.json"]);
  });

  it("les URL visent le dépôt autorisé par lib/update/check.ts", () => {
    expect(prefix).toMatch(/^https:\/\/github\.com\/[^/]+\/jobscout\/releases\/$/);
    expect(cfg.urls.releases).toBe(`${prefix}latest`);
    expect(cfg.urls.download).toBe(`${prefix}latest/download/${cfg.dmgName}`);
    expect(cfg.urls.guide).toBe(`${repo}blob/main/INSTALL-MAC.md`);
  });

  it("une configuration abîmée est refusée, avec la raison", () => {
    const broken = structuredClone(cfg);
    broken.bundleIdentifier = "fr jobscout";
    broken.ports = { first: 3500, last: 3477 };
    broken.urls.download = "http://exemple.invalid/JobScout.dmg";
    const p = macConfigProblems(broken);
    expect(p.some((x: string) => x.startsWith("bundleIdentifier"))).toBe(true);
    expect(p.some((x: string) => x.startsWith("ports"))).toBe(true);
    expect(p.some((x: string) => x.startsWith("urls.download"))).toBe(true);
    expect(macConfigProblems(null)).toEqual(["mac.json : objet attendu"]);
  });
});

// --------------------------------------------------------------- Info.plist
describe("Info.plist", () => {
  const SAME = "JobScout enregistre vos CV et lettres dans le dossier que vous avez choisi.";
  const EXPECTED = {
    CFBundleDevelopmentRegion: "fr",
    CFBundleDisplayName: "JobScout",
    CFBundleExecutable: "JobScout",
    CFBundleIconFile: "JobScout",
    CFBundleIdentifier: "fr.jobscout.app",
    CFBundleInfoDictionaryVersion: "6.0",
    CFBundleName: "JobScout",
    CFBundlePackageType: "APPL",
    CFBundleShortVersionString: "3.4.18",
    CFBundleVersion: "3.4.18",
    LSApplicationCategoryType: "public.app-category.productivity",
    LSMinimumSystemVersion: "11.0",
    NSHighResolutionCapable: true,
    NSHumanReadableCopyright: "JobScout — licence MIT",
    NSAppTransportSecurity: { NSAllowsLocalNetworking: true },
    NSLocalNetworkUsageDescription:
      "JobScout se connecte à une IA locale installée sur un autre appareil de votre réseau, seulement si vous l'avez configurée.",
    NSDocumentsFolderUsageDescription: SAME,
    NSDesktopFolderUsageDescription: SAME,
    JobScoutDataDirName: "JobScout",
    JobScoutReleasesURL: "https://github.com/latenightsbeats1208-pixel/jobscout/releases/latest",
    JobScoutPortFirst: 3477,
    JobScoutPortLast: 3500,
  };

  it("contient exactement les clés et valeurs de la conception", () => {
    expect(infoPlistDict(cfg, "3.4.18")).toEqual(EXPECTED);
  });

  it("ne pose aucune des clés volontairement absentes", () => {
    expect(FORBIDDEN_INFO_KEYS).toEqual([
      "LSUIElement",
      "LSMultipleInstancesProhibited",
      "LSFileQuarantineEnabled",
      "NSSupportsSuddenTermination",
    ]);
    const dict = infoPlistDict(cfg, "3.4.18");
    for (const k of FORBIDDEN_INFO_KEYS) expect(k in dict).toBe(false);
  });

  it("le XML écrit se relit à l'identique (types, accents, tiret long)", () => {
    const xml = infoPlistXml(cfg, "3.4.18");
    expect(parsePlist(xml)).toEqual(EXPECTED);
    expect(xml).toContain("<key>JobScoutPortFirst</key>\n\t<integer>3477</integer>");
    expect(xml).toContain("<key>NSHighResolutionCapable</key>\n\t<true/>");
    expect(xml).toContain("JobScout — licence MIT");
    expect(xml).toContain("installée sur un autre appareil");
  });

  it("suit la version du projet (version.json)", () => {
    const v = readProjectVersion();
    expect(v).toMatch(/^\d+\.\d+\.\d+$/);
    const dict = infoPlistDict(cfg, v);
    expect(dict.CFBundleShortVersionString).toBe(v);
    expect(dict.CFBundleVersion).toBe(v);
  });

  it("refuse une version hors du format X.Y.Z", () => {
    for (const bad of ["3.4", "3.4.18-beta", "v3.4.18", "", undefined]) {
      expect(() => infoPlistDict(cfg, bad as unknown as string)).toThrow(/invalide/);
    }
  });

  it("PkgInfo vaut APPL????", () => {
    expect(PKGINFO).toBe("APPL????");
    expect(Buffer.byteLength(PKGINFO, "ascii")).toBe(8);
  });
});

describe("échappement XML", () => {
  it("échappe &, < et >, garde les guillemets et apostrophes", () => {
    expect(escapeXml(`a & b < c > d "e" 'f'`)).toBe(`a &amp; b &lt; c &gt; d "e" 'f'`);
    expect(escapeXml("&amp;")).toBe("&amp;amp;");
  });

  it("une valeur piégée se relit intacte, clés comprises", () => {
    const tricky = { "clé <&>": `</string><key>x</key><string>&lt;`, imbriqué: { liste: ["é", 1, false] }, vide: {} };
    expect(parsePlist(plistXml(tricky))).toEqual(tricky);
  });

  it("refuse les caractères interdits en XML, les décimaux et les valeurs absentes", () => {
    expect(() => escapeXml("a\u0000b")).toThrow(/contrôle/);
    expect(() => escapeXml("a\u001bb")).toThrow(/contrôle/);
    expect(escapeXml("ligne\nsuivante\ttab")).toBe("ligne\nsuivante\ttab");
    expect(() => plistXml({ n: 1.5 })).toThrow(/entier/);
    expect(() => plistXml({ n: null })).toThrow(/absente/);
  });
});

// ----------------------------------------------------- droits et signature
describe("droits du node embarqué (node.entitlements.plist)", () => {
  const ent = parsePlist(read("installer/mac/node.entitlements.plist")) as Record<string, unknown>;

  it("exactement allow-jit et allow-unsigned-executable-memory", () => {
    expect(ent).toEqual({ [ALLOW_JIT]: true, [ALLOW_UNSIGNED_MEMORY]: true });
    for (const k of Object.keys(ent)) {
      expect(k).not.toMatch(/get-task-allow|allow-dyld|disable-library-validation/);
    }
  });

  it("la variante de référence de la répétition = ce fichier ; l'autre = allow-jit seul", () => {
    const ref = REHEARSAL_VARIANTS.filter((v) => v.reference);
    expect(ref).toHaveLength(1);
    expect([...ref[0].keys].sort()).toEqual(Object.keys(ent).sort());
    expect(REHEARSAL_VARIANTS.map((v) => v.keys)).toEqual([[ALLOW_JIT], [ALLOW_JIT, ALLOW_UNSIGNED_MEMORY]]);
  });

  it("le JS de répétition s'exécute et finit par la ligne exacte attendue", () => {
    const r = spawnSync(process.execPath, ["-e", JIT_SCRIPT], { encoding: "utf8", timeout: 60_000 });
    expect(r.status).toBe(0);
    expect(r.stdout.trim().split("\n").pop()).toMatch(/^jit-ok 20000 \d+$/);
  });
});

describe("mode de signature (5 secrets)", () => {
  const all = Object.fromEntries(SIGNING_SECRETS.map((k: string) => [k, `valeur-secrete-${k.length}`]));

  it("les 5 noms de la conception", () => {
    expect(SIGNING_SECRETS).toEqual([
      "JOBSCOUT_MAC_CERT_P12_BASE64",
      "JOBSCOUT_MAC_CERT_PASSWORD",
      "JOBSCOUT_MAC_NOTARY_KEY_P8_BASE64",
      "JOBSCOUT_MAC_NOTARY_KEY_ID",
      "JOBSCOUT_MAC_NOTARY_ISSUER_ID",
    ]);
  });

  it("aucun → adhoc ; les cinq → developer-id ; vides ou blancs → absents", () => {
    expect(macSigningMode({})).toBe("adhoc");
    expect(macSigningMode(all)).toBe("developer-id");
    expect(macSigningMode(Object.fromEntries(SIGNING_SECRETS.map((k: string) => [k, ""])))).toBe("adhoc");
    expect(macSigningMode(Object.fromEntries(SIGNING_SECRETS.map((k: string) => [k, "  "])))).toBe("adhoc");
  });

  it("de 1 à 4 secrets : erreur qui nomme les manquants sans jamais citer une valeur", () => {
    for (let n = 1; n <= 4; n++) {
      const partial = Object.fromEntries(SIGNING_SECRETS.slice(0, n).map((k: string) => [k, all[k]]));
      let message = "";
      try {
        macSigningMode(partial);
      } catch (e) {
        message = (e as Error).message;
      }
      expect(message).toMatch(new RegExp(`^configuration de signature partielle : ${n}/5`));
      for (const k of SIGNING_SECRETS.slice(n)) expect(message).toContain(k);
      expect(message).not.toContain("valeur-secrete");
    }
  });

  it("lit find-identity et codesign -dvv", () => {
    const ids = parseIdentities(
      '  1) 0123456789ABCDEF0123456789ABCDEF01234567 "Developer ID Application: Jean Exemple (AB12CD34EF)"\n' +
        '  2) 89ABCDEF0123456789ABCDEF0123456789ABCDEF "Apple Development: Jean Exemple (ZZ99ZZ99ZZ)"\n' +
        "     2 valid identities found\n"
    );
    expect(ids.map((i) => i.team)).toEqual(["AB12CD34EF", "ZZ99ZZ99ZZ"]);
    expect(ids[0].sha1).toBe("0123456789ABCDEF0123456789ABCDEF01234567");

    const dev = codesignDetails(
      "Executable=/x/JobScout.app/Contents/MacOS/JobScout\nIdentifier=fr.jobscout.app\n" +
        "CodeDirectory v=20500 size=1234 flags=0x10000(runtime) hashes=30+7 location=embedded\n" +
        "Authority=Developer ID Application: Jean Exemple (AB12CD34EF)\nAuthority=Developer ID Certification Authority\n" +
        "Authority=Apple Root CA\nTimestamp=21 Oct 2026 at 10:00:00\nTeamIdentifier=AB12CD34EF\n"
    );
    expect(dev).toMatchObject({ team: "AB12CD34EF", adhoc: false, runtime: true, timestamp: true });
    expect(dev.authorities[0]).toBe("Developer ID Application: Jean Exemple (AB12CD34EF)");

    const adhoc = codesignDetails(
      "Executable=/x/node\nCodeDirectory v=20400 size=99 flags=0x2(adhoc) hashes=1+0 location=embedded\nSignature=adhoc\nTeamIdentifier=not set\n"
    );
    expect(adhoc).toMatchObject({ adhoc: true, runtime: false, timestamp: false, authorities: [] });
  });
});

// ------------------------------------------------------------ Node épinglé
describe("Node darwin épinglé (node-darwin.json)", () => {
  it("valeurs exactes de la conception, même version que le Node Windows", () => {
    const pins = JSON.parse(read("installer/mac/node-darwin.json"));
    expect(pins).toEqual({
      version: "v22.23.2",
      "darwin-arm64": "61130f394c1630d211dd50aecc4353d379480f36d3ac913cd85dbba1aed585c6",
      "darwin-x64": "58e99022c2ff89395576cc7fd4d98cea24bb68081475d5f88b801ee8729fb026",
    });
    expect(readPins()).toEqual(pins);
    expect(() => checkPinsAligned(pins, JSON.parse(read("installer/node-runtime.json")))).not.toThrow();
  });

  it("une version Windows différente exige de ré-épingler", () => {
    expect(() => checkPinsAligned(readPins(), { version: "v22.99.0" })).toThrow(/ré-épingler/);
  });

  it("un épinglage mal formé est refusé", () => {
    const dir = tempDir();
    const f = path.join(dir, "node-darwin.json");
    fs.writeFileSync(f, JSON.stringify({ version: "v22.23.2", "darwin-arm64": "abc", "darwin-x64": "0".repeat(64) }));
    expect(() => readPins(f)).toThrow(/darwin-arm64/);
    fs.writeFileSync(f, JSON.stringify({ version: "22.23.2", "darwin-arm64": "0".repeat(64), "darwin-x64": "0".repeat(64) }));
    expect(() => readPins(f)).toThrow(/version/);
  });

  it("noms d'archives et lecture de SHASUMS256.txt", () => {
    expect(archiveName("v22.23.2", "darwin-arm64")).toBe("node-v22.23.2-darwin-arm64.tar.gz");
    const sums = parseShasums(
      "61130F394C1630D211DD50AECC4353D379480F36D3AC913CD85DBBA1AED585C6  node-v22.23.2-darwin-arm64.tar.gz\r\n" +
        "58e99022c2ff89395576cc7fd4d98cea24bb68081475d5f88b801ee8729fb026 *node-v22.23.2-darwin-x64.tar.gz\n" +
        "ligne illisible\n"
    );
    expect(sums.get("node-v22.23.2-darwin-arm64.tar.gz")).toBe("61130f394c1630d211dd50aecc4353d379480f36d3ac913cd85dbba1aed585c6");
    expect(sums.get("node-v22.23.2-darwin-x64.tar.gz")).toBe("58e99022c2ff89395576cc7fd4d98cea24bb68081475d5f88b801ee8729fb026");
    expect(sums.size).toBe(2);
  });
});

describe("minos (vtool) et versions", () => {
  const slice = (arch: string, minos: string) =>
    `/tmp/node (architecture ${arch}):\nLoad command 10\n      cmd LC_BUILD_VERSION\n  cmdsize 32\n platform MACOS\n` +
    `    minos ${minos}\n      sdk 14.0\n   ntools 1\n     tool LD\n  version 1053.12\n`;

  it("lit une tranche par architecture, sans prendre la version de l'outil LD", () => {
    expect(parseVtoolMinos(slice("x86_64", "11.0") + slice("arm64", "11.0"))).toEqual([
      { arch: "x86_64", minos: "11.0", cmd: "LC_BUILD_VERSION" },
      { arch: "arm64", minos: "11.0", cmd: "LC_BUILD_VERSION" },
    ]);
  });

  it("lit LC_VERSION_MIN_MACOSX ; rien trouvé → tableau vide", () => {
    expect(parseVtoolMinos("Load command 8\n      cmd LC_VERSION_MIN_MACOSX\n  cmdsize 16\n  version 10.15\n      sdk 11.0\n")).toEqual([
      { arch: null, minos: "10.15", cmd: "LC_VERSION_MIN_MACOSX" },
    ]);
    expect(parseVtoolMinos("")).toEqual([]);
    expect(parseVtoolMinos("error: /tmp/x: not a Mach-O file\n")).toEqual([]);
  });

  it("compare des versions pointées", () => {
    expect(versionAtMost("11.0", "11.0")).toBe(true);
    expect(versionAtMost("11", "11.0")).toBe(true);
    expect(versionAtMost("10.15", "11.0")).toBe(true);
    expect(versionAtMost("11.1", "11.0")).toBe(false);
    expect(versionAtMost("13.5", "11.0")).toBe(false);
  });
});

// ------------------------------------------------------- textes du DMG
describe("LISEZ-MOI du DMG", () => {
  const template = read("installer/mac/LISEZ-MOI.txt");
  const text = renderReadme(template, { version: "3.4.18" });

  it("la version vient du modèle, jamais écrite en dur", () => {
    expect(template).toContain("{{version}}");
    expect(template).not.toMatch(/JobScout \d+\.\d+\.\d+/);
    expect(text.startsWith("﻿JobScout 3.4.18 pour Mac\n")).toBe(true);
    expect(text).not.toContain("{{");
    expect(() => renderReadme("JobScout {{autre}}", { version: "3.4.18" })).toThrow(/non substituée/);
  });

  it("guide, adresse et données cohérents avec mac.json", () => {
    const urls = text.match(/https?:\/\/[^\s)]+/g) ?? [];
    expect(urls).toEqual([`http://127.0.0.1:${cfg.ports.first}`, cfg.urls.guide]);
    expect(text).toContain(`~/Library/Application Support/${cfg.dataDirName}`);
  });

  it("consignes de la conception, sans repli « xattr », au vouvoiement, fins de ligne \\n", () => {
    expect(text).toContain("N'ouvrez pas JobScout depuis cette fenêtre.");
    expect(text).toContain("« Placer dans la corbeille »");
    expect(text).toContain("« Ouvrir quand même »");
    expect(text).toContain("Quitter JobScout (⌘Q)");
    expect(text).not.toMatch(/xattr/i);
    expect(text).not.toMatch(/\b(tu|toi|ton|ta|tes)\b/i);
    expect(text).not.toContain("\r");
  });

  it("SHA256SUMS.txt au format de shasum, relu à l'identique", () => {
    const h = "a".repeat(64);
    expect(sumsLine(h, "JobScout-Mac.dmg")).toBe(`${h}  JobScout-Mac.dmg\n`);
    expect(parseShasumLine(sumsLine(h, "JobScout-Mac.dmg"), "JobScout-Mac.dmg")).toBe(h);
    expect(parseShasumLine(`${h} *JobScout-Mac.dmg`, "JobScout-Mac.dmg")).toBe(h);
    expect(parseShasumLine(`${h}  JobScout-Mac.dmg.part`, "JobScout-Mac.dmg")).toBeNull();
    expect(parseShasumLine("JobScout-Mac.dmg: FAILED", "JobScout-Mac.dmg")).toBeNull();
  });
});

// --------------------------------------------- documentation ↔ mac.json
/** Ancre GitHub d'un titre (algorithme de github-slugger). */
function githubSlug(heading: string): string {
  const visible = heading
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/[`*]/g, "")
    .trim()
    .toLowerCase();
  return visible.replace(/[^\p{L}\p{M}\p{N}\p{Pc}\- ]/gu, "").replace(/ /g, "-");
}

function anchorsOf(markdown: string): Set<string> {
  const seen = new Map<string, number>();
  const out = new Set<string>();
  let fence: string | null = null;
  for (const line of markdown.split(/\r?\n/)) {
    const f = /^\s*(```|~~~)/.exec(line);
    if (f) {
      fence = fence === null ? f[1] : fence === f[1] ? null : fence;
      continue;
    }
    if (fence) continue;
    const h = /^#{1,6}\s+(.+?)\s*#*\s*$/.exec(line);
    if (!h) continue;
    const base = githubSlug(h[1]);
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    out.add(n ? `${base}-${n}` : base);
  }
  return out;
}

describe("documentation ↔ mac.json", () => {
  const docs = [
    ...fs.readdirSync(ROOT).filter((f) => f.endsWith(".md")),
    "installer/README.md",
    "installer/mac/README.md",
  ].filter((f) => fs.existsSync(path.join(ROOT, f)));
  const repo = cfg.urls.releases.replace(/releases\/latest$/, "");

  it("calcule les ancres comme GitHub", () => {
    expect(githubSlug("Étape 1 — Installer Node.js")).toBe("étape-1--installer-nodejs");
    expect(githubSlug("Les tutoriels vidéo sur Mac")).toBe("les-tutoriels-vidéo-sur-mac");
    expect(githubSlug("Faut-il laisser le Mac allumé ?")).toBe("faut-il-laisser-le-mac-allumé-");
    expect(githubSlug("2. Option A : une clé payante Claude (recommandé)")).toBe("2-option-a--une-clé-payante-claude-recommandé");
    expect([...anchorsOf("# A\n```\n# B\n```\n## A\n")]).toEqual(["a", "a-1"]);
  });

  it("tout lien de téléchargement du DMG vaut exactement celui de mac.json", () => {
    const seen: string[] = [];
    for (const doc of docs) {
      for (const found of read(doc).match(/https?:\/\/[^\s)"'<>\]`]+/g) ?? []) {
        const url = found.replace(/[.,;:!?]+$/, "");
        if (/\.dmg$/i.test(url) && /\/jobscout\//i.test(url)) {
          seen.push(doc);
          expect(`${doc} : ${url}`).toBe(`${doc} : ${cfg.urls.download}`);
        }
      }
    }
    expect(seen).toContain("README.md");
    expect(seen).toContain("INSTALL-MAC.md");
  });

  it("toute page des versions citée est celle du dépôt de mac.json", () => {
    for (const doc of docs) {
      for (const url of read(doc).match(/https?:\/\/[^\s)"'<>\]`]+\/jobscout\/releases[^\s)"'<>\]`]*/g) ?? []) {
        expect(`${doc} : ${url.startsWith(`${repo}releases`)}`).toBe(`${doc} : true`);
      }
    }
  });

  it("toute ancre vers INSTALL-MAC.md existe dans INSTALL-MAC.md", () => {
    const target = anchorsOf(read("INSTALL-MAC.md"));
    const missing: string[] = [];
    let checked = 0;
    for (const doc of docs) {
      const text = read(doc);
      const refs = doc === "INSTALL-MAC.md"
        ? [...text.matchAll(/\]\(#([^)\s]+)\)/g)].map((m) => m[1])
        : [...text.matchAll(/INSTALL-MAC\.md#([^)\s"'>]+)/g)].map((m) => m[1]);
      for (const raw of refs) {
        checked++;
        const a = decodeURIComponent(raw);
        if (!target.has(a)) missing.push(`${doc} → #${a}`);
      }
    }
    expect(missing).toEqual([]);
    expect(checked).toBeGreaterThan(0);
  });
});

// ------------------------------------------------------------------ icône
describe("icône .icns", () => {
  const SET = ICONSET as unknown as Array<[string, number]>;
  it("les 10 images d'un .iconset, de 16 à 1024 px", () => {
    expect(SET).toHaveLength(10);
    const names = SET.map(([n]) => n);
    expect(new Set(names).size).toBe(10);
    for (const [name, size] of SET) {
      const m = /^icon_(\d+)x(\d+)(@2x)?\.png$/.exec(name);
      expect(m).not.toBeNull();
      expect(m![1]).toBe(m![2]);
      expect(size).toBe(Number(m![1]) * (m![3] ? 2 : 1));
    }
    expect(Math.min(...SET.map(([, s]) => s))).toBe(16);
    expect(Math.max(...SET.map(([, s]) => s))).toBe(1024);
  });

  /** Relit un PNG : signature, CRC de chaque bloc, en-tête et pixels décompressés. */
  function decodePng(png: Buffer) {
    expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    let o = 8;
    const chunks: Array<{ type: string; data: Buffer }> = [];
    while (o < png.length) {
      const len = png.readUInt32BE(o);
      const type = png.toString("ascii", o + 4, o + 8);
      const data = png.subarray(o + 8, o + 8 + len);
      expect(png.readUInt32BE(o + 8 + len)).toBe(zlib.crc32(png.subarray(o + 4, o + 8 + len)) >>> 0);
      chunks.push({ type, data });
      o += 12 + len;
    }
    expect(chunks.map((c) => c.type)).toEqual(["IHDR", "IDAT", "IEND"]);
    const ihdr = chunks[0].data;
    return {
      width: ihdr.readUInt32BE(0),
      height: ihdr.readUInt32BE(4),
      depth: ihdr[8],
      colorType: ihdr[9],
      raw: zlib.inflateSync(chunks[1].data),
    };
  }

  it("encode un PNG RGBA valide, pixels intacts", () => {
    const rgba = Buffer.from([...Array(3 * 2 * 4).keys()].map((i) => (i * 37) % 256));
    const d = decodePng(encodePng(3, 2, rgba));
    expect([d.width, d.height, d.depth, d.colorType]).toEqual([3, 2, 8, 6]);
    expect(d.raw).toEqual(Buffer.concat([Buffer.from([0]), rgba.subarray(0, 12), Buffer.from([0]), rgba.subarray(12)]));
    expect(() => encodePng(2, 2, Buffer.alloc(3))).toThrow(/octets RGBA/);
  });

  it("repasse en alpha droit les couleurs prémultipliées par le moyennage", () => {
    expect([...unpremultiply(Buffer.from([50, 100, 150, 128, 10, 20, 30, 0, 1, 2, 3, 255]))]).toEqual([
      100, 199, 255, 128, 0, 0, 0, 0, 1, 2, 3, 255,
    ]);
  });

  it("dessine l'iconset avec render() de make-icon.mjs et la marge macOS", async () => {
    const render = await loadRender();
    expect(typeof render).toBe("function");
    const dir = path.join(tempDir(), "JobScout.iconset");
    const written = await writeIconset(dir);
    expect(written.map((w) => w.name)).toEqual(SET.map(([n]) => n));
    for (const [name, size] of SET) {
      const d = decodePng(fs.readFileSync(path.join(dir, name)));
      expect([d.width, d.height]).toEqual([size, size]);
    }
    // Marge de 10 % : le coin (1 px du bord) est transparent à 1024 px.
    const big = decodePng(fs.readFileSync(path.join(dir, "icon_512x512@2x.png")));
    const stride = 1024 * 4 + 1;
    expect(big.raw[stride * 50 + 1 + 50 * 4 + 3]).toBe(0);
    expect(big.raw[stride * 512 + 1 + 512 * 4 + 3]).toBe(255);
  });

  it("contrôle l'en-tête d'un .icns", () => {
    const ok = Buffer.alloc(16);
    ok.write("icns", 0, "ascii");
    ok.writeUInt32BE(16, 4);
    expect(icnsHeaderProblems(ok)).toEqual([]);
    const bad = Buffer.from(ok);
    bad.writeUInt32BE(99, 4);
    expect(icnsHeaderProblems(bad)).toHaveLength(1);
    expect(icnsHeaderProblems(Buffer.from("png"))).toEqual(["fichier trop court"]);
  });
});

// ------------------------------------------------- arborescence et gardes
describe("arborescence du paquet", () => {
  it("contenu exact des dossiers de JobScout.app", () => {
    expect(expectedBundleLayout(cfg)).toEqual({
      Contents: ["Info.plist", "MacOS", "PkgInfo", "Resources"],
      "Contents/MacOS": ["JobScout", "node"],
      "Contents/Resources": ["JobScout.icns", "LICENSE-Node.js.txt", "THIRD_PARTY_NOTICES.txt", "app", "parent-guard.cjs"],
    });
  });

  it("repère noms non ASCII, .DS_Store, ._* et liens symboliques", () => {
    const root = tempDir();
    fs.mkdirSync(path.join(root, "a", "b"), { recursive: true });
    fs.writeFileSync(path.join(root, "a", "b", "ok.js"), "x");
    fs.writeFileSync(path.join(root, "été.txt"), "x");
    fs.writeFileSync(path.join(root, ".DS_Store"), "x");
    fs.writeFileSync(path.join(root, "a", "._ok.js"), "x");
    let linked = false;
    try {
      fs.symlinkSync(path.join(root, "a"), path.join(root, "lien"), "dir");
      linked = true;
    } catch {
      /* Windows sans le droit de créer des liens : partie ignorée */
    }
    const t = inspectTree(root);
    expect(t.files).toEqual([".DS_Store", "a/._ok.js", "a/b/ok.js", "été.txt"]);
    expect(t.dirs).toEqual(["a", "a/b"]);
    expect(t.nonAscii).toEqual(["été.txt"]);
    expect(t.dsStore).toEqual([".DS_Store"]);
    expect(t.appleDouble).toEqual(["a/._ok.js"]);
    expect(t.symlinks).toEqual(linked ? ["lien"] : []);
    expect(treeProblems(t)).toHaveLength(linked ? 4 : 3);
  });

  it("reconnaît les binaires par le contenu (installer/macho.mjs), jamais par le nom", async () => {
    const root = tempDir();
    fs.mkdirSync(path.join(root, "MacOS"));
    fs.writeFileSync(path.join(root, "MacOS", "node"), Buffer.concat([Buffer.from("cffaedfe", "hex"), Buffer.alloc(60)]));
    fs.writeFileSync(path.join(root, "MacOS", "universel"), Buffer.concat([Buffer.from("cafebabe00000002", "hex"), Buffer.alloc(80)]));
    fs.writeFileSync(path.join(root, "Classe.class"), Buffer.concat([Buffer.from("cafebabe00000034", "hex"), Buffer.alloc(80)]));
    fs.writeFileSync(path.join(root, "faux.dylib"), "texte, pas un binaire");
    fs.writeFileSync(path.join(root, "script.sh"), "#!/bin/sh\necho ok\n");
    expect(await findExecutableBinaries(root)).toEqual(["MacOS/node", "MacOS/universel"]);
    expect(await findExecutableBinaries(root, { detect: (abs: string) => abs.endsWith(".sh") })).toEqual(["script.sh"]);
  });

  it("contenu de Resources/app : présents exigés, sharp, @img, .env, base et Chromium refusés", () => {
    const app = tempDir();
    for (const f of [...REQUIRED_APP_FILES, "lib/geo/data/geo-fr.json.gz", ".next/static/chunks/a.js"]) {
      fs.mkdirSync(path.dirname(path.join(app, f)), { recursive: true });
      fs.writeFileSync(path.join(app, f), "x");
    }
    expect(appContentProblems(app)).toEqual([]);
    fs.mkdirSync(path.join(app, "node_modules", "sharp"), { recursive: true });
    fs.mkdirSync(path.join(app, "node_modules", "@img", "sharp-darwin-arm64"), { recursive: true });
    fs.mkdirSync(path.join(app, "browsers", "chromium_headless_shell-1148"), { recursive: true });
    fs.writeFileSync(path.join(app, ".env"), "x");
    fs.writeFileSync(path.join(app, "data", "jobscout.db"), "x");
    fs.rmSync(path.join(app, "node_modules", "playwright-core", "cli.js"));
    const p = appContentProblems(app);
    expect(p).toEqual(
      expect.arrayContaining([
        "absent : node_modules/playwright-core/cli.js",
        "interdit : .env",
        "interdit : data/jobscout.db",
        "interdit : node_modules/sharp/",
        "interdit : node_modules/@img/",
        "interdit (Chromium) : browsers/chromium_headless_shell-1148/",
      ])
    );
    expect(p).toHaveLength(6);
  });

  it("chemins de la machine de construction cherchés bruts et échappés (\\/)", () => {
    const n = buildMachineNeedles({ cwd: "/Users/runner/work/jobscout/jobscout", project: "/Users/runner/work/jobscout/jobscout", home: "/Users/runner" });
    expect(n.map((x) => x.form)).toEqual([
      "/Users/runner/work/jobscout/jobscout",
      "\\/Users\\/runner\\/work\\/jobscout\\/jobscout",
      "/Users/runner",
      "\\/Users\\/runner",
    ]);
    expect(buildMachineNeedles({ cwd: "/", project: "/", home: "/" })).toEqual([]);
  });

  it("options de build-mac.mjs : variante de test refusée, option inconnue refusée", () => {
    expect(parseArgs([])).toEqual({ nextBuild: true });
    expect(parseArgs(["--no-next-build"])).toEqual({ nextBuild: false });
    expect(parseArgs(["--variant=prod"])).toEqual({ nextBuild: true });
    expect(() => parseArgs(["--variant", "test"])).toThrow(/refusée sur Mac/);
    expect(() => parseArgs(["--variant=test"])).toThrow(/refusée sur Mac/);
    expect(() => parseArgs(["--assemble-only"])).toThrow(/option inconnue/);
  });
});
