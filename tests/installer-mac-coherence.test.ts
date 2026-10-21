// Paquet Mac : cohérence entre les pièces écrites séparément — workflow ↔
// scripts, lanceur Swift ↔ Info.plist (bundle.mjs) ↔ recette ↔ documentation,
// noms des fichiers livrés ↔ mac.json. Lecture de fichiers seulement : tourne
// sous Windows, Linux et macOS, sans compilateur Swift ni outil d'Apple.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { expectedBundleLayout, infoPlistDict, loadMacConfig, readProjectVersion } from "../installer/mac/bundle.mjs";
import { SIGNING_SECRETS } from "../installer/mac/sign-mac.mjs";
import { SLICES, SOURCES, swiftcArgs } from "../installer/mac/launcher/build-launcher-mac.mjs";
import { ASSET_NAMES, COLLECTION, DMG_NAME, REPORT_NAME, SUMS_NAME } from "../installer/mac/publier.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
// Fins de ligne ramenées à « \n » : sous Windows, la CI extrait le dépôt en « \r\n ».
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf-8").replace(/\r\n/g, "\n");
const cfg = loadMacConfig();
const LAUNCHER_DIR = "installer/mac/launcher";
const WORKFLOW = read(".github/workflows/installeur-mac.yml");
const SWIFT = (SOURCES as string[]).map((f) => read(`${LAUNCHER_DIR}/${f}`)).join("\n");
/** Code Swift sans les commentaires de fin de ligne (les mots-clés des commentaires ne comptent pas). */
const SWIFT_CODE = SWIFT.split("\n")
  .map((l) => l.replace(/\/\/.*$/, ""))
  .join("\n");
const RECETTE = read("installer/mac/test-install-mac.mjs");
const INSTALL_MAC = read("INSTALL-MAC.md");
const DEV_README = read("installer/mac/README.md");
const LISEZ_MOI = read("installer/mac/LISEZ-MOI.txt");

/** Tableau littéral Swift `static let <nom> = [ "a", "b" ]` → ["a", "b"]. */
function swiftStringArray(name: string): string[] {
  const m = new RegExp(`static let ${name} = \\[([^\\]]*)\\]`).exec(SWIFT_CODE);
  if (!m) throw new Error(`tableau Swift ${name} introuvable`);
  return [...m[1].matchAll(/"([^"]*)"/g)].map((x) => x[1]);
}

describe("workflow installeur-mac.yml ↔ scripts et mac.json", () => {
  it("artefact JobScout-Mac : exactement les trois fichiers de mac.json, envoyés puis relus", () => {
    for (const name of [cfg.dmgName, cfg.sumsName, cfg.reportName]) {
      expect(WORKFLOW).toContain(`installer/output/mac/${name}`);
    }
    for (const flag of [`--dmg dist-mac/${cfg.dmgName}`, `--sums dist-mac/${cfg.sumsName}`, `--rapport dist-mac/${cfg.reportName}`]) {
      expect(WORKFLOW).toContain(flag);
    }
    expect(WORKFLOW).toContain(`installer/output/mac/${cfg.bundleName}.app`);
    expect(WORKFLOW).toContain(`subject-path: dist-mac/${cfg.dmgName}`);
  });

  it("publier.mjs publie les noms de mac.json : le DMG et ses empreintes, pas le rapport", () => {
    expect([DMG_NAME, SUMS_NAME, REPORT_NAME]).toEqual([cfg.dmgName, cfg.sumsName, cfg.reportName]);
    expect([...ASSET_NAMES]).toEqual([cfg.dmgName, cfg.sumsName]);
    expect([...COLLECTION].sort()).toEqual([cfg.dmgName, cfg.sumsName, cfg.reportName].sort());
  });

  it("secrets : les 5 de sign-mac.mjs, passés sous leur nom aux 2 seules étapes qui signent", () => {
    const used = [...WORKFLOW.matchAll(/secrets\.([A-Z0-9_]+)/g)].map((m) => m[1]);
    expect([...new Set(used)].sort()).toEqual([...(SIGNING_SECRETS as string[])].sort());
    for (const name of SIGNING_SECRETS as string[]) {
      const lines = WORKFLOW.split("\n").filter((l) => l.includes(`secrets.${name} `));
      expect(lines, name).toHaveLength(2);
      for (const l of lines) expect(l.trim()).toBe(`${name}: \${{ secrets.${name} }}`);
    }
    // Les deux étapes : sign-mac.mjs app et make-dmg.mjs (signature du DMG).
    const steps = WORKFLOW.split(/\n(?=\s*- )/).filter((s) => s.includes("secrets."));
    expect(steps).toHaveLength(2);
    expect(steps[0]).toContain("node installer/mac/sign-mac.mjs app");
    expect(steps[1]).toContain("node installer/mac/make-dmg.mjs");
  });

  it("chaque script appelé existe, et chacune de ses options y est lue", () => {
    const calls = [...WORKFLOW.matchAll(/node (installer\/[\w./-]+\.mjs)([^\n|]*)/g)];
    expect(calls.length).toBeGreaterThanOrEqual(10);
    for (const [, script, args] of calls) {
      expect(fs.existsSync(path.join(ROOT, script)), script).toBe(true);
      const src = read(script);
      for (const opt of args.match(/(?<![\w-])--[a-z][\w-]*/g) ?? []) {
        expect(src.includes(opt) || src.includes(`"${opt.slice(2)}"`) || src.includes(`${opt.slice(2)}:`), `${script} ${opt}`).toBe(true);
      }
    }
  });

  it("actions tierces épinglées par un SHA de 40 caractères", () => {
    const uses = [...WORKFLOW.matchAll(/uses:\s*(\S+)/g)].map((m) => m[1]);
    expect(uses.length).toBeGreaterThan(0);
    for (const u of uses) expect(u, u).toMatch(/^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/);
  });

  it("le journal de construction passe par tee sans masquer le code de build-mac.mjs (pipefail)", () => {
    const step = WORKFLOW.split(/\n(?=\s*- )/).find((s) => s.includes("node installer/mac/build-mac.mjs"));
    expect(step).toBeDefined();
    expect(step).toContain("| tee ");
    expect(step).toContain("set -o pipefail");
  });

  it("recette sur les 4 Mac de la conception, sans arrêt au premier runner en échec", () => {
    expect(WORKFLOW).toContain("os: [macos-15, macos-26, macos-15-intel, macos-26-intel]");
    expect(WORKFLOW).toMatch(/fail-fast: false/);
  });
});

describe("lanceur Swift ↔ Info.plist, paquet et recette", () => {
  const plist = infoPlistDict(cfg, readProjectVersion());

  it("ne lit dans Info.plist que des clés écrites par bundle.mjs, et lit toutes les clés JobScout*", () => {
    const keys = [...SWIFT_CODE.matchAll(/(?:string|integer)\("([A-Za-z]+)"\)/g)].map((m) => m[1]);
    expect(keys.length).toBeGreaterThanOrEqual(6);
    for (const k of keys) expect(Object.keys(plist), k).toContain(k);
    const own = Object.keys(plist).filter((k) => k.startsWith("JobScout"));
    expect(own.sort()).toEqual([...new Set(keys.filter((k) => k.startsWith("JobScout")))].sort());
    expect(typeof plist.JobScoutPortFirst).toBe("number"); // <integer>, lu par integer()
  });

  it("cherche node, server.js et parent-guard.cjs là où bundle.mjs les pose", () => {
    const layout = expectedBundleLayout(cfg);
    expect(layout["Contents/MacOS"]).toEqual([cfg.executableName, "node"].sort());
    expect(layout["Contents/Resources"]).toContain("app");
    expect(layout["Contents/Resources"]).toContain("parent-guard.cjs");
    for (const p of ['"MacOS/node"', '"Resources/app"', '"Resources/parent-guard.cjs"', '"/server.js"', '"server.js"']) {
      expect(SWIFT_CODE, p).toContain(p);
    }
  });

  it("codes de sortie : ceux de la conception, documentés, et ceux qu'attend la recette", () => {
    const codes = [...SWIFT_CODE.matchAll(/static let \w+: Int32 = (\d+)/g)].map((m) => Number(m[1])).sort((a, b) => a - b);
    expect(codes).toEqual([0, 1, 2, 64, 66, 69, 70, 71]);
    for (const c of codes) expect(DEV_README, `code ${c}`).toMatch(new RegExp(`^\\| ${c} \\|`, "m"));
    for (const c of [0, 2, 64, 70]) expect(RECETTE, `recette, code ${c}`).toMatch(new RegExp(`code === ${c}\\b`));
  });

  it("options lues par le lanceur et passées par la recette", () => {
    for (const opt of ["--no-browser", "--non-interactive", "--self-test"]) {
      expect(SWIFT_CODE).toContain(`case "${opt}"`);
      expect(RECETTE).toContain(`"${opt}"`);
    }
  });

  it("environnement : la liste retirée est celle de la conception, et couvre chaque piège de la recette", () => {
    const removed = swiftStringArray("removed");
    expect(removed.sort()).toEqual(
      ["NODE_OPTIONS", "NODE_PATH", "HOSTNAME", "PORT", "JOBSCOUT_VERSION", "JOBSCOUT_DB_PATH", "JOBSCOUT_DOCS_PATH", "PLAYWRIGHT_BROWSERS_PATH"].sort()
    );
    const trapBlock = /function launcherEnv[\s\S]*?Object\.assign\(env, \{([\s\S]*?)\}\);/.exec(RECETTE);
    expect(trapBlock).not.toBeNull();
    const traps = [...trapBlock![1].matchAll(/^\s*([A-Z_]+):/gm)].map((m) => m[1]).filter((k) => !k.startsWith("ANTHROPIC_"));
    expect(traps.length).toBeGreaterThanOrEqual(5);
    for (const t of traps) expect(removed, t).toContain(t);
    expect(swiftStringArray("requiredPath")).toEqual(["/usr/bin", "/bin", "/usr/sbin", "/sbin"]);
    expect(SWIFT_CODE).toContain('env["HOSTNAME"] = "127.0.0.1"');
    expect(SWIFT_CODE).not.toMatch(/env\["JOBSCOUT_(UPDATE_URL|VERSION)"\]\s*=/);
  });

  it("ports par défaut du self-test = ceux de mac.json", () => {
    expect(SWIFT_CODE).toContain(`config?.portFirst ?? ${cfg.ports.first}`);
    expect(SWIFT_CODE).toContain(`config?.portLast ?? ${cfg.ports.last}`);
  });

  it("aucune Swift Concurrency : la bibliothèque est absente de macOS 11", () => {
    expect(SWIFT_CODE).not.toMatch(/(?<![.\w])async\b|\bawait\b|\bTask\s*\{|\bactor\s+[A-Z]|@MainActor|@Sendable/);
  });

  it("build-launcher-mac.mjs compile exactement les .swift du dossier, en mode 5, pour le macOS minimum", () => {
    const onDisk = fs.readdirSync(path.join(ROOT, LAUNCHER_DIR)).filter((f) => f.endsWith(".swift")).sort();
    expect([...(SOURCES as string[])].sort()).toEqual(onDisk);
    expect(SLICES).toEqual(["x86_64", "arm64"]);
    const args = swiftcArgs("arm64", "/sortie/JobScout-arm64", { minimum: cfg.minimumSystemVersion, sourceDir: "." }) as string[];
    expect(args.slice(args.indexOf("-swift-version"), args.indexOf("-swift-version") + 2)).toEqual(["-swift-version", "5"]);
    expect(args).toContain(`arm64-apple-macos${cfg.minimumSystemVersion}`);
    expect(args.filter((a) => a.endsWith(".swift"))).toEqual(SOURCES);
    expect(read(`${LAUNCHER_DIR}/build-launcher-mac.mjs`)).toMatch(/sourceDir: "\." \}\), \{ allowFail: true, cwd: HERE \}/);
  });
});

describe("textes du lanceur ↔ guide Mac et LISEZ-MOI du DMG", () => {
  // Titres des AlertSpec seulement (les NSMenuItem ont aussi un « title: »).
  const titles = [...SWIFT_CODE.matchAll(/id: "E\d",\s*title: "([^"]+)"/g)].map((m) => m[1]);

  it("les 6 alertes E1 à E6 : chaque titre du lanceur est cité tel quel par le guide", () => {
    expect([...SWIFT_CODE.matchAll(/id: "(E\d)"/g)].map((m) => m[1])).toEqual(["E1", "E2", "E3", "E4", "E5", "E6"]);
    expect(titles).toHaveLength(6);
    for (const t of titles) expect(INSTALL_MAC, t).toContain(t);
    // E5 : titre et message lus d'un trait, comme le guide les cite.
    expect(INSTALL_MAC).toContain("« L'application est incomplète. Retéléchargez JobScout. »");
    expect(SWIFT_CODE).toContain('title: "L\'application est incomplète."');
    expect(SWIFT_CODE).toContain('message: "Retéléchargez JobScout."');
  });

  it("fenêtre (F1 à F3) et menus : textes du lanceur cités tels quels", () => {
    for (const t of [
      "JobScout démarre…",
      "Le premier démarrage peut prendre jusqu'à une minute : macOS vérifie l'application.",
      "JobScout est prêt",
      "Ouvrir le dossier Applications",
      "Ouvrir le journal",
      "Ouvrir JobScout",
      "Dossier de données",
      "Journal du serveur",
      "Page des versions",
      "Quitter JobScout",
      "À propos de JobScout",
    ]) {
      expect(SWIFT_CODE, t).toContain(`"${t}"`);
      expect(INSTALL_MAC, t).toContain(t);
    }
    expect(SWIFT_CODE).toContain('"o")'); // Ouvrir JobScout : ⌘O, comme le dit le guide
    expect(INSTALL_MAC).toContain("**Ouvrir JobScout** (⌘O)");
  });

  it("le LISEZ-MOI du DMG renvoie aux menus réels du lanceur", () => {
    expect(LISEZ_MOI).toContain("menu JobScout > Quitter JobScout (⌘Q)");
    expect(LISEZ_MOI).toContain("menu JobScout > Dossier de données");
    expect(SWIFT_CODE).toContain('NSMenuItem(title: "Quitter JobScout"');
    expect(LISEZ_MOI).toContain(`http://127.0.0.1:${cfg.ports.first}`);
    expect(LISEZ_MOI).toContain(`~/Library/Application Support/${cfg.dataDirName}`);
  });
});
