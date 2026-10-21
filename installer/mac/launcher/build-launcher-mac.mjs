// ============================================================================
// installer/mac/launcher/build-launcher-mac.mjs
//
// Compile le lanceur Swift de JobScout.app (main.swift, Supervisor.swift,
// AppUI.swift) en binaire UNIVERSEL (x86_64 + arm64), sur un runner macOS :
//
//   swiftc -O -swift-version 5 -strict-concurrency=minimal
//          -enable-upcoming-feature ConciseMagicFile -module-name JobScoutLauncher
//          -target <arch>-apple-macos<minimum> -framework AppKit
//          -Xlinker -dead_strip_dylibs main.swift Supervisor.swift AppUI.swift
//          -o out/JobScout-<arch>                      (x86_64 puis arm64)
//   lipo -create … -output out/JobScout
//   codesign --force -s - --timestamp=none out/JobScout
//   JobScout --self-test                               (dans un paquet d'essai)
//
// Options de swiftc :
//   -swift-version 5            Swift 6 (Xcode 16) en mode de langage 5 : les
//                               règles d'isolation strictes de Swift 6 ne
//                               s'appliquent pas à ce code GCD/AppKit ;
//   -strict-concurrency=minimal explicite (valeur par défaut du mode 5) ;
//   -enable-upcoming-feature ConciseMagicFile
//                               #file vaut « Module/Fichier.swift » et non le chemin
//                               complet de la machine de construction ;
//   -module-name                obligatoire : le nom tiré de -o (« JobScout-arm64 »)
//                               n'est pas un identifiant Swift valide ;
//   -Xlinker -dead_strip_dylibs aucune bibliothèque chargée sans être utilisée.
//
// Contrôles bloquants (::error puis code 1) :
//   - aucune dépendance FORTE à libswift_Concurrency.dylib : absente de macOS 11,
//     elle ferait planter le lanceur au chargement (ni async/await ni Swift
//     Concurrency dans le code, seulement GCD) ;
//   - `lipo -archs` exactement « x86_64 arm64 » ;
//   - aucun chemin de la machine de construction dans le binaire (dossier des
//     sources, dossier personnel) : check-leaks refuserait le paquet ;
//   - minos de chaque tranche ≤ LSMinimumSystemVersion (mac.json), jamais de
//     décalage silencieux ;
//   - signature ad hoc vérifiée (codesign --verify --strict) ;
//   - `--self-test` de la tranche native : code 0. Le binaire seul n'a pas
//     d'Info.plist : il est copié dans un paquet d'essai out/selftest/JobScout.app
//     avec l'Info.plist réel (bundle.mjs, depuis mac.json et version.json).
//     Sur un runner arm64 où Rosetta est installé, la tranche x86_64 passe
//     aussi le self-test (information : la recette Intel fait foi).
//
// Utilisation :
//   node installer/mac/launcher/build-launcher-mac.mjs [<dossier> | --out <dossier>] [--no-self-test]
//   import { buildLauncherMac } from "./launcher/build-launcher-mac.mjs"   (build-mac.mjs)
//
// Aucun effet de bord à l'import (garde isMainModule) : `node --check` et les
// fonctions pures (swiftcArgs, parseLoadDylibs) sont utilisables sous Windows.
// ============================================================================
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  annotate,
  checkUniversal,
  fail,
  hasTool,
  infoPlistXml,
  isMainModule,
  loadMacConfig,
  notice,
  readProjectVersion,
  requireDarwin,
  run,
  runMain,
  stepSummary,
  warning,
} from "../bundle.mjs";

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_OUT = path.join(HERE, "out");
export const SOURCES = ["main.swift", "Supervisor.swift", "AppUI.swift"];
/** Ordre des tranches pour lipo : `lipo -archs` affiche alors « x86_64 arm64 ». */
export const SLICES = ["x86_64", "arm64"];
export const MODULE_NAME = "JobScoutLauncher";
const TITLE = "Lanceur Mac";

/** Arguments de swiftc pour une tranche. */
export function swiftcArgs(arch, output, { minimum = "11.0", sourceDir = HERE } = {}) {
  if (!SLICES.includes(arch)) throw new Error(`architecture « ${arch} » inattendue (${SLICES.join(", ")})`);
  if (!/^\d+(\.\d+)*$/.test(String(minimum))) throw new Error(`macOS minimum « ${minimum} » invalide`);
  return [
    "-O",
    "-swift-version", "5",
    "-strict-concurrency=minimal",
    "-enable-upcoming-feature", "ConciseMagicFile",
    "-module-name", MODULE_NAME,
    "-target", `${arch}-apple-macos${minimum}`,
    "-framework", "AppKit",
    "-Xlinker", "-dead_strip_dylibs",
    ...SOURCES.map((f) => path.join(sourceDir, f)),
    "-o", output,
  ];
}

/**
 * Sortie de `otool -l` → bibliothèques chargées : [{ cmd, name }], cmd valant
 * LC_LOAD_DYLIB, LC_LOAD_WEAK_DYLIB, LC_REEXPORT_DYLIB ou LC_LOAD_UPWARD_DYLIB.
 */
export function parseLoadDylibs(text) {
  const out = [];
  let cmd = null;
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    const c = /^cmd (LC_[A-Z0-9_]+)$/.exec(line);
    if (c) {
      cmd = c[1];
      continue;
    }
    if (cmd && /^LC_(LOAD|LOAD_WEAK|REEXPORT|LOAD_UPWARD|LAZY_LOAD)_DYLIB$/.test(cmd)) {
      const m = /^name (.+?) \(offset \d+\)$/.exec(line);
      if (m) {
        out.push({ cmd, name: m[1] });
        cmd = null;
      }
    }
  }
  return out;
}

/**
 * Chemins de la machine de construction présents dans le binaire (dossier des
 * sources, dossier personnel) : renvoie ceux qui y figurent. Le contrôle
 * anti-fuite du paquet (check-leaks, dossier personnel en terme interdit)
 * refuserait le .app ; ce contrôle le dit dès la compilation.
 */
export function embeddedPathProblems(buffer, needles) {
  return needles
    .filter((n) => typeof n === "string" && n.length >= 4)
    .filter((n) => buffer.includes(Buffer.from(n, "utf8")));
}

/** Dépendance qui ferait planter le lanceur sur macOS 11 (bibliothèque absente). */
export function concurrencyProblems(dylibs) {
  return dylibs
    .filter((d) => /libswift_Concurrency\.dylib$/.test(d.name) && d.cmd !== "LC_LOAD_WEAK_DYLIB")
    .map((d) => `${d.cmd} ${d.name}`);
}

function compileSlice(arch, output, minimum) {
  const t0 = Date.now();
  // Sources passées en chemins RELATIFS, depuis leur dossier : #filePath et
  // les messages du compilateur ne portent alors que « main.swift »…, jamais le
  // chemin de la machine de construction (en plus de ConciseMagicFile).
  const r = run("swiftc", swiftcArgs(arch, output, { minimum, sourceDir: "." }), { allowFail: true, cwd: HERE });
  const messages = `${r.stdout}${r.stderr}`.trim();
  if (r.error || r.status !== 0 || !fs.existsSync(output)) {
    // Toute la sortie du compilateur : l'erreur utile n'est pas toujours à la fin.
    if (messages) process.stdout.write(`${messages}\n`);
    fail(TITLE, `swiftc (${arch}) a échoué : ${r.error ? r.error.message : `code ${r.status}`}. Sortie complète ci-dessus.`);
  }
  const warnings = (messages.match(/\bwarning:/g) || []).length;
  if (warnings) process.stdout.write(`${messages}\n`);
  return { seconds: (Date.now() - t0) / 1000, warnings };
}

function checkDylibs(file, arch) {
  const dylibs = parseLoadDylibs(run("otool", ["-arch", arch, "-l", file]).stdout);
  if (!dylibs.length) fail(TITLE, `${path.basename(file)} (${arch}) : aucune bibliothèque lue par otool -l.`);
  const bad = concurrencyProblems(dylibs);
  if (bad.length) {
    fail(
      TITLE,
      `${path.basename(file)} (${arch}) dépend de ${bad.join(", ")}, absente de macOS 11 : le lanceur ` +
        "planterait au chargement. Retirez tout usage de Swift Concurrency (async/await, Task, @MainActor explicite) du lanceur."
    );
  }
  return dylibs;
}

function selfTestBundle(binary, dir, { cfg, version }) {
  fs.rmSync(dir, { recursive: true, force: true });
  const app = path.join(dir, `${cfg.bundleName}.app`);
  const macos = path.join(app, "Contents", "MacOS");
  fs.mkdirSync(macos, { recursive: true });
  const plist = path.join(app, "Contents", "Info.plist");
  fs.writeFileSync(plist, infoPlistXml(cfg, version), "utf-8");
  run("plutil", ["-lint", plist]);
  const exe = path.join(macos, cfg.executableName);
  fs.copyFileSync(binary, exe);
  fs.chmodSync(exe, 0o755);
  return exe;
}

function runSelfTest(exe, { viaRosetta = false } = {}) {
  const env = {
    PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
    HOME: process.env.HOME || "/tmp",
    TMPDIR: process.env.TMPDIR || "/tmp",
  };
  const [cmd, args] = viaRosetta ? ["arch", ["-x86_64", exe, "--self-test"]] : [exe, ["--self-test"]];
  const r = run(cmd, args, { allowFail: true, env, timeout: 60_000 });
  const output = `${r.stdout}${r.stderr}`.trim();
  return { status: r.status, signal: r.signal, output, error: r.error };
}

function rosettaAvailable() {
  if (process.arch !== "arm64") return false;
  return run("arch", ["-x86_64", "/usr/bin/true"], { allowFail: true }).status === 0;
}

/**
 * Construit out/JobScout (universel, signé ad hoc, self-test passé).
 * Renvoie { binary, archs, minos, bytes, seconds, warnings, selfTest }.
 */
export function buildLauncherMac({
  outDir = DEFAULT_OUT,
  cfg = loadMacConfig(),
  version = readProjectVersion(),
  selfTest = true,
} = {}) {
  requireDarwin(TITLE);
  for (const tool of ["swiftc", "lipo", "codesign", "xcrun", "otool", "plutil"]) {
    if (!hasTool(tool)) fail(TITLE, `outil « ${tool} » introuvable (Xcode et ses outils en ligne de commande requis).`);
  }
  const t0 = Date.now();
  outDir = path.resolve(outDir); // swiftc tourne depuis le dossier des sources
  const swiftVersion = run("swiftc", ["--version"], { allowFail: true });
  notice(TITLE, `${`${swiftVersion.stdout}${swiftVersion.stderr}`.trim().split("\n")[0]} ; cible macOS ${cfg.minimumSystemVersion}`);

  fs.mkdirSync(outDir, { recursive: true });
  const binary = path.join(outDir, cfg.executableName);
  const slices = {};
  let warnings = 0;
  for (const arch of SLICES) {
    const thin = path.join(outDir, `${cfg.executableName}-${arch}`);
    fs.rmSync(thin, { force: true });
    const c = compileSlice(arch, thin, cfg.minimumSystemVersion);
    warnings += c.warnings;
    const dylibs = checkDylibs(thin, arch);
    slices[arch] = { file: thin, seconds: c.seconds, dylibs };
  }

  fs.rmSync(binary, { force: true });
  run("lipo", ["-create", "-output", binary, ...SLICES.map((a) => slices[a].file)]);
  const { archs, minos } = checkUniversal(binary, { minimum: cfg.minimumSystemVersion, label: "lanceur" });
  for (const arch of SLICES) checkDylibs(binary, arch); // le binaire livré, tranche par tranche
  const embedded = embeddedPathProblems(fs.readFileSync(binary), [HERE, path.resolve(HERE, "..", "..", ".."), os.homedir()]);
  if (embedded.length) {
    fail(
      TITLE,
      `le lanceur contient ${embedded.length} chemin(s) de la machine de construction (dossier des sources ou dossier ` +
        "personnel), par exemple dans un message de déballage forcé (« ! ») : retirez les « ! » et les types « T! » du code Swift."
    );
  }

  run("codesign", ["--force", "-s", "-", "--timestamp=none", binary]);
  run("codesign", ["--verify", "--strict", "--verbose=2", binary]);
  for (const arch of SLICES) fs.rmSync(slices[arch].file, { force: true });

  const result = {
    binary,
    archs,
    minos,
    bytes: fs.statSync(binary).size,
    seconds: 0,
    warnings,
    dylibs: slices.arm64.dylibs.map((d) => `${d.cmd === "LC_LOAD_WEAK_DYLIB" ? "(faible) " : ""}${d.name}`),
    selfTest: { native: null, rosetta: null },
  };

  if (selfTest) {
    const dir = path.join(outDir, "selftest");
    const exe = selfTestBundle(binary, dir, { cfg, version });
    const native = runSelfTest(exe);
    if (native.output) process.stdout.write(`${native.output}\n`);
    if (native.error || native.status !== 0) {
      fail(TITLE, `JobScout --self-test (${process.arch}) : ${native.error ? native.error.message : `code ${native.status}${native.signal ? ` (${native.signal})` : ""}`}, 0 attendu.`);
    }
    result.selfTest.native = { arch: process.arch === "arm64" ? "arm64" : "x86_64", status: 0 };
    if (rosettaAvailable()) {
      const x86 = runSelfTest(exe, { viaRosetta: true });
      result.selfTest.rosetta = { status: x86.status };
      if (x86.status === 0) {
        notice(TITLE, "tranche x86_64 lancée par Rosetta : self-test 0");
      } else {
        if (x86.output) process.stdout.write(`${x86.output}\n`);
        warning(TITLE, `tranche x86_64 sous Rosetta : self-test code ${x86.status} (la recette Intel fait foi)`);
      }
    } else if (process.arch === "arm64") {
      notice(TITLE, "Rosetta absente sur ce runner : tranche x86_64 non lancée ici (recette Intel)");
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }

  result.seconds = (Date.now() - t0) / 1000;
  const ko = Math.round(result.bytes / 1024);
  notice(
    TITLE,
    `${path.basename(binary)} : ${archs}, minos ${SLICES.map((a) => `${a} ${minos[a]}`).join(", ")}, ${ko} Ko, ` +
      `${warnings} avertissement(s) de compilation, ${result.seconds.toFixed(1)} s`
  );
  notice(TITLE, `bibliothèques chargées : ${result.dylibs.join(", ")}`);
  stepSummary(
    `**Lanceur** : ${archs}, minos ${SLICES.map((a) => `${a} ${minos[a]}`).join(" / ")}, ${ko} Ko, ` +
      `self-test ${selfTest ? "0" : "non lancé"}${result.selfTest.rosetta ? `, Rosetta ${result.selfTest.rosetta.status}` : ""}`
  );
  return result;
}

if (isMainModule(import.meta.url)) {
  await runMain(TITLE, async () => {
    // Dossier de sortie : premier argument positionnel (comme
    // installer/launcher/build-launcher.mjs, et ainsi l'appelle build-mac.mjs)
    // ou --out <dossier> ; par défaut installer/mac/launcher/out.
    const args = process.argv.slice(2);
    const outIdx = args.indexOf("--out");
    const positional = args.find((a, i) => !a.startsWith("--") && (outIdx < 0 || i !== outIdx + 1));
    const chosen = outIdx >= 0 && args[outIdx + 1] ? args[outIdx + 1] : positional;
    const outDir = chosen ? path.resolve(chosen) : DEFAULT_OUT;
    const r = buildLauncherMac({ outDir, selfTest: !args.includes("--no-self-test") });
    annotate("notice", TITLE, `prêt : ${r.binary}`);
  });
}
