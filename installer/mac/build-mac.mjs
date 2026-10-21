// ============================================================================
// installer/mac/build-mac.mjs — construction de JobScout.app (macOS).
//
//   node installer/mac/build-mac.mjs                  chaîne complète
//   node installer/mac/build-mac.mjs --no-next-build  réutilise le .next existant
//
// Sortie : installer/output/mac/JobScout.app (scellée ad hoc) et
// installer/output/mac/rapport-construction.json. Le DMG vient ensuite
// (make-dmg.mjs), après la signature Developer ID éventuelle (sign-mac.mjs app).
// Aucun secret n'est lu ici.
//
// Chaque étape bloque (::error puis code 1) :
//   1. préconditions (macOS, outils ; --variant test refusé) ;
//   2. next build ;
//   3. assemble({ target: "mac" }) → installer/dist/JobScout/app ;
//   4. élagage de node_modules/sharp et node_modules/@img ;
//   5. gardes sur app/ : 0 binaire exécutable (par le contenu), 0 chemin de la
//      machine de construction (projet, dossier personnel), 0 lien, 0 nom non
//      ASCII ; .wasm de tesseract-core absents → avertissement seulement ;
//   6. anti-fuite (check-leaks, dossier personnel en terme supplémentaire) ;
//   7. Node universel (fetch-node-mac.mjs) ;
//   8. démarrage à blanc : routes sans 5xx, arrêt à la fermeture de stdin,
//      app/ inchangée (tree-digest avant / après) ;
//   9. lanceur (launcher/build-launcher-mac.mjs) et icône (make-icns.mjs) ;
//  10. paquet (bundle.mjs) et ses contrôles ;
//  11. anti-fuite sur le .app avant signature ;
//  12. scellement ad hoc (sans --deep) puis codesign --verify --deep --strict ;
//  13. rapport-construction.json, ::notice et résumé de l'étape.
// ============================================================================
import fs from "node:fs";
import os from "node:os";
import net from "node:net";
import path from "node:path";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { assemble } from "../assemble.mjs";
import { allRoutes } from "../build.mjs";
import { checkLeaks, homeDirNeedles } from "../check-leaks.mjs";
import { compareDigests, treeDigest } from "../tree-digest.mjs";
import {
  HERE,
  OUTPUT_MAC,
  PROJECT,
  StepError,
  bundlePathFor,
  checkBundle,
  checkUniversal,
  createBundle,
  dirBytes,
  fail,
  findExecutableBinaries,
  hasTool,
  inspectTree,
  isMainModule,
  loadMacConfig,
  mo,
  notice,
  readProjectVersion,
  requireDarwin,
  run,
  runMain,
  stepSummary,
  treeProblems,
  warning,
} from "./bundle.mjs";
import { ensureNodeMac, parseCodesignIdentity } from "./fetch-node-mac.mjs";
import { makeIcns } from "./make-icns.mjs";

const REQUIRED_TOOLS = ["swiftc", "lipo", "codesign", "hdiutil", "iconutil", "ditto", "plutil", "xattr", "xcrun"];
const SMOKE_PORT = 3919;
const PARENT_GUARD = path.join(HERE, "parent-guard.cjs");
const LAUNCHER_SCRIPT = path.join(HERE, "launcher", "build-launcher-mac.mjs");
const NOTICES = path.join(PROJECT, "THIRD_PARTY_NOTICES.txt");

const log = (m) => process.stdout.write(`[build-mac] ${m}\n`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const firstLine = (s) => String(s ?? "").trim().split("\n")[0] ?? "";

// --------------------------------------------------------------- étape 1
export function parseArgs(argv) {
  const opts = { nextBuild: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--no-next-build") opts.nextBuild = false;
    else if (a === "--variant" || a.startsWith("--variant=")) {
      const v = a.includes("=") ? a.split("=")[1] : argv[++i];
      if (v !== "prod") {
        throw new Error(`--variant ${v ?? ""} : la variante de test est refusée sur Mac en v1 (seule « prod » existe).`);
      }
    } else throw new Error(`option inconnue : ${a} (options : --no-next-build)`);
  }
  return opts;
}

function preconditions(argv) {
  requireDarwin("1. Préconditions");
  const opts = parseArgs(argv);
  if (process.env.JOBSCOUT_BUILD_VARIANT) {
    warning("1. Préconditions", `JOBSCOUT_BUILD_VARIANT=${process.env.JOBSCOUT_BUILD_VARIANT} ignorée : le paquet Mac est toujours « prod ».`);
  }
  const missing = REQUIRED_TOOLS.filter((t) => !hasTool(t));
  if (missing.length) throw new Error(`outils absents : ${missing.join(", ")}`);
  const vt = run("xcrun", ["--find", "vtool"], { allowFail: true });
  if (vt.status !== 0) throw new Error("xcrun vtool introuvable (Xcode 12 ou plus requis).");
  const info = {
    macos: run("sw_vers", ["-productVersion"]).stdout.trim(),
    arch: run("uname", ["-m"]).stdout.trim(),
    xcode: firstLine(run("xcodebuild", ["-version"], { allowFail: true }).stdout) || "inconnu",
    sdk: run("xcrun", ["--show-sdk-version"], { allowFail: true }).stdout.trim() || "inconnu",
    swift: firstLine(run("swiftc", ["--version"], { allowFail: true }).stderr) ||
      firstLine(run("swiftc", ["--version"], { allowFail: true }).stdout) || "inconnu",
    node: process.version,
  };
  notice("Outils de construction", `macOS ${info.macos} ${info.arch} — ${info.xcode} (SDK ${info.sdk}) — ${info.swift} — Node ${info.node} (pilote)`);
  return { opts, info };
}

// --------------------------------------------------------------- étape 2
function nextBuild() {
  const nextBin = path.join(PROJECT, "node_modules", "next", "dist", "bin", "next");
  if (!fs.existsSync(nextBin)) throw new Error("CLI Next introuvable : npm ci ?");
  execFileSync(process.execPath, [nextBin, "build"], {
    cwd: PROJECT,
    stdio: "inherit",
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" },
  });
}

// --------------------------------------------------------------- étape 3
async function assembleMac(version) {
  const result = await assemble({ target: "mac" });
  const payload = result?.payload;
  if (!payload) throw new Error("assemble() n'a pas renvoyé de payload.");
  const app = result.app ?? path.join(payload, "app");
  if (!fs.existsSync(path.join(app, "server.js"))) throw new Error(`${app}/server.js absent après assemblage.`);
  // target « mac » : retour AVANT les étapes Windows 7 à 10.
  const windows = ["runtime/node.exe", "JobScout.exe", "jobscout.ico"].filter((f) => fs.existsSync(path.join(payload, f)));
  if (windows.length) {
    throw new Error(`assemble() a produit des pièces Windows (${windows.join(", ")}) : target « mac » non pris en compte.`);
  }
  const readme = path.join(app, "data", "LISEZ-MOI.txt");
  if (!fs.existsSync(readme)) throw new Error("app/data/LISEZ-MOI.txt absent.");
  const text = fs.readFileSync(readme, "utf-8");
  if (text.includes("\r")) throw new Error("app/data/LISEZ-MOI.txt : fins de ligne Windows (\\r\\n), \\n attendu sur Mac.");
  if (!text.includes("Application Support") || text.includes("%LOCALAPPDATA%")) {
    throw new Error("app/data/LISEZ-MOI.txt : chemins Windows au lieu de ~/Library/Application Support.");
  }
  const appVersion = JSON.parse(fs.readFileSync(path.join(app, "version.json"), "utf-8")).version;
  if (appVersion !== version) throw new Error(`app/version.json (${appVersion}) ≠ version.json (${version}).`);
  return { payload, app };
}

// --------------------------------------------------------------- étape 4
function prune(app) {
  const removed = [];
  const nm = inspectTree(path.join(app, "node_modules")).dirs
    .filter((d) => /(^|\/)node_modules\/(sharp|@img)$/.test(`node_modules/${d}`))
    .map((d) => `node_modules/${d}`)
    // Les plus profonds d'abord, et jamais un dossier déjà supprimé avec son parent.
    .sort((a, b) => b.length - a.length);
  for (const rel of nm) {
    const abs = path.join(app, ...rel.split("/"));
    if (!fs.existsSync(abs)) continue;
    const bytes = dirBytes(abs);
    fs.rmSync(abs, { recursive: true, force: true });
    removed.push({ path: rel, bytes });
  }
  return removed;
}

// --------------------------------------------------------------- étape 5
/** Chemins de la machine de construction, bruts et échappés en JSON (\/). */
export function buildMachineNeedles({ cwd, project, home }) {
  const out = [];
  const add = (label, p) => {
    if (!p || p.length < 4 || p === "/") return;
    for (const form of [p, p.replace(/\//g, "\\/")]) {
      if (!out.some((n) => n.form === form)) out.push({ label, form });
    }
  };
  add("dossier du projet (process.cwd())", cwd);
  add("dossier du projet", project);
  add("dossier personnel (os.homedir())", home);
  return out;
}

async function guards(app) {
  const tree = inspectTree(app);
  const problems = treeProblems(tree);

  const bins = await findExecutableBinaries(app, { files: tree.files });
  if (bins.length) problems.push(`${bins.length} binaire(s) exécutable(s) dans app/ (Mach-O, PE ou ELF) : ${bins.slice(0, 15).join(", ")}`);

  const home = os.homedir();
  if (!home || home === "/") throw new Error(`dossier personnel inattendu : « ${home} »`);
  const needles = buildMachineNeedles({ cwd: process.cwd(), project: PROJECT, home });
  const hits = [];
  for (const rel of tree.files) {
    const text = fs.readFileSync(path.join(app, ...rel.split("/"))).toString("latin1");
    for (const n of needles) if (text.includes(n.form)) hits.push(`${rel} (${n.label}${n.form.includes("\\/") ? ", forme \\/" : ""})`);
  }
  if (hits.length) problems.push(`${hits.length} chemin(s) de la machine de construction : ${hits.slice(0, 15).join(", ")}`);

  if (problems.length) throw new Error(`app/ non conforme :\n  - ${problems.join("\n  - ")}`);

  const wasm = tree.files.filter((f) => /^node_modules\/tesseract\.js-core\/[^/]+\.wasm$/.test(f));
  if (!wasm.length) {
    warning("5. Gardes sur app/", "aucun .wasm de tesseract.js-core dans app/ : l'OCR des CV en image ne fonctionnera probablement pas (lot à part).");
  }
  return { files: tree.files.length, bytes: dirBytes(app), wasm: wasm.length };
}

// --------------------------------------------------------------- étape 6
/**
 * check-leaks avec le dossier personnel en terme supplémentaire. Témoin
 * positif d'abord : si l'option extraNeedles n'était pas prise en compte, le
 * contrôle serait inopérant sans que rien ne le montre.
 */
function leakCheck(target, label) {
  const home = os.homedir();
  const extraNeedles = homeDirNeedles(home);
  if (!extraNeedles.length) throw new Error(`dossier personnel non discriminant pour l'anti-fuite : « ${home} »`);
  const probe = fs.mkdtempSync(path.join(os.tmpdir(), "jobscout-temoin-"));
  try {
    fs.writeFileSync(path.join(probe, "temoin.txt"), `chemin ${home}/x\n`);
    const control = checkLeaks([probe], { extraNeedles, verbose: false });
    if (!control.findings.length) {
      throw new Error("check-leaks ignore l'option extraNeedles (témoin positif non détecté) : contrôle inopérant.");
    }
  } finally {
    fs.rmSync(probe, { recursive: true, force: true });
  }
  const { findings, scanned, needleCount } = checkLeaks([target], { extraNeedles });
  log(`  ${label} : ${scanned} fichiers scannés, ${needleCount} termes recherchés`);
  if (!scanned) throw new Error(`${label} : aucun fichier scanné.`);
  if (findings.length) {
    throw new Error(
      `${findings.length} fuite(s) dans ${label} :\n  - ` +
        findings.slice(0, 40).map((f) => `${f.file} :: ${f.kind}`).join("\n  - ")
    );
  }
  return { scanned, findings: 0 };
}

// --------------------------------------------------------------- étape 8
/** Instantané de app/ (installer/tree-digest.mjs) ; jamais vide. */
function snapshot(dir) {
  const d = treeDigest(dir);
  if (!d.files) throw new Error(`instantané vide : ${dir}`);
  return d;
}

/** Chemins ajoutés (+), retirés (-) ou modifiés (~) entre deux instantanés. */
function digestDiff(before, after) {
  const cmp = compareDigests(before, after);
  return {
    equal: cmp.equal,
    paths: [
      ...cmp.added.map((e) => `+ ${e.path}`),
      ...cmp.removed.map((e) => `- ${e.path}`),
      ...cmp.changed.map((c) => `~ ${c.path}`),
    ],
  };
}

function portFree(port) {
  return new Promise((resolve) => {
    const sock = net.connect({ host: "127.0.0.1", port });
    sock.once("connect", () => {
      sock.destroy();
      resolve(false);
    });
    sock.once("error", () => resolve(true));
  });
}

async function smokeTest({ payload, app, node, version }) {
  if (!fs.existsSync(PARENT_GUARD)) throw new Error("installer/mac/parent-guard.cjs absent.");
  if (!fs.existsSync(path.join(app, ".next", "app-path-routes-manifest.json"))) {
    throw new Error("app/.next/app-path-routes-manifest.json absent : impossible de balayer les routes.");
  }
  const routes = allRoutes(payload);
  if (routes.length < 2) throw new Error(`manifeste des routes presque vide (${routes.length} route).`);
  if (!(await portFree(SMOKE_PORT))) throw new Error(`port ${SMOKE_PORT} déjà occupé.`);

  const before = snapshot(app);
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "jobscout-smoke-"));
  const dirs = { home: path.join(sandbox, "home"), tmp: path.join(sandbox, "tmp"), data: path.join(sandbox, "data") };
  for (const d of Object.values(dirs)) fs.mkdirSync(d, { recursive: true });

  const t0 = Date.now();
  // stdin en TUBE : avec la garde armée, /dev/null donnerait une fin de fichier immédiate.
  const child = spawn(node, ["--require", PARENT_GUARD, "server.js"], {
    cwd: app,
    detached: true, // groupe de processus propre, comme sous le lanceur (POSIX_SPAWN_SETPGROUP)
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      PATH: "/usr/bin:/bin",
      HOME: dirs.home,
      TMPDIR: dirs.tmp,
      NODE_ENV: "production",
      NEXT_TELEMETRY_DISABLED: "1",
      HOSTNAME: "127.0.0.1",
      PORT: String(SMOKE_PORT),
      JOBSCOUT_DATA_DIR: dirs.data,
      JOBSCOUT_DISABLE_UPDATE_CHECK: "1",
      JOBSCOUT_PARENT_GUARD: "1",
    },
  });
  const out = [];
  child.stdout.on("data", (b) => out.push(b.toString()));
  child.stderr.on("data", (b) => out.push(b.toString()));
  child.stdin.on("error", () => {});
  let exit = null;
  child.on("exit", (code, signal) => (exit = { code, signal, at: Date.now() }));
  const tail = () => out.join("").slice(-2500);

  try {
    const base = `http://127.0.0.1:${SMOKE_PORT}`;
    let ready = null;
    const deadline = Date.now() + 120_000;
    while (Date.now() < deadline && !exit) {
      try {
        const res = await fetch(`${base}/api/update`, { signal: AbortSignal.timeout(2500) });
        if (res.status === 200) {
          const body = await res.json();
          if (body.current !== version) throw new StepError("8. Démarrage à blanc", `/api/update : current « ${body.current} » ≠ ${version}.`);
          ready = (Date.now() - t0) / 1000;
          break;
        }
      } catch (e) {
        if (e instanceof StepError) throw e;
      }
      await sleep(400);
    }
    if (ready === null) {
      throw new Error(`${exit ? `serveur arrêté (code ${exit.code}, signal ${exit.signal})` : "pas de réponse en 120 s"} :\n${tail()}`);
    }
    log(`  serveur prêt en ${ready.toFixed(1)} s (/api/update, version ${version})`);

    const broken = [];
    for (const route of routes) {
      let status = 0;
      try {
        const res = await fetch(base + route, { redirect: "manual", signal: AbortSignal.timeout(20_000) });
        status = res.status;
        try { await res.body?.cancel(); } catch { /* flux déjà fermé */ }
      } catch {
        status = 0;
      }
      if (status === 0 || status >= 500) broken.push(`${route} → ${status || "pas de réponse"}`);
    }
    if (broken.length) {
      const missing = [...new Set(out.join("").match(/Cannot find module '[^']+'/g) || [])].join(", ");
      throw new Error(`routes en échec dans le paquet :\n  ${broken.join("\n  ")}${missing ? `\nmodules manquants : ${missing}` : ""}`);
    }
    log(`  ${routes.length} routes sans réponse 5xx`);

    const closedAt = Date.now();
    child.stdin.end();
    while (!exit && Date.now() - closedAt < 10_000) await sleep(100);
    if (!exit) throw new Error(`le serveur ne s'est pas arrêté dans les 10 s après la fermeture de stdin :\n${tail()}`);
    const stopSeconds = (exit.at - closedAt) / 1000;
    const guardLine = /\[jobscout\] arrêt du serveur/.test(out.join(""));
    log(`  arrêt ${stopSeconds.toFixed(1)} s après la fermeture de stdin (code ${exit.code}, signal ${exit.signal}${guardLine ? ", par la garde" : ""})`);

    const diff = digestDiff(before, snapshot(app));
    if (!diff.equal) {
      throw new Error(`le serveur a écrit dans l'app : ${diff.paths.slice(0, 20).join(", ")}${diff.paths.length > 20 ? ", …" : ""}`);
    }
    return { routes: routes.length, readySeconds: ready, stopSeconds };
  } finally {
    if (!exit) {
      try { process.kill(-child.pid, "SIGKILL"); } catch { /* déjà arrêté */ }
      await sleep(500);
    }
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
}

// --------------------------------------------------------------- étape 9
function buildLauncher(cfg) {
  const outDir = path.join(OUTPUT_MAC, "lanceur");
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  if (!fs.existsSync(LAUNCHER_SCRIPT)) throw new Error("installer/mac/launcher/build-launcher-mac.mjs absent.");
  const r = spawnSync(process.execPath, [LAUNCHER_SCRIPT, outDir], { cwd: PROJECT, stdio: "inherit" });
  if (r.status !== 0) throw new Error(`build-launcher-mac.mjs : code ${r.status}${r.signal ? ` (${r.signal})` : ""}.`);
  const exe = path.join(outDir, cfg.executableName);
  if (!fs.existsSync(exe)) throw new Error(`build-launcher-mac.mjs a réussi sans produire ${cfg.executableName}.`);
  const u = checkUniversal(exe, { minimum: cfg.minimumSystemVersion, label: "lanceur" });
  return { exe, ...u, bytes: fs.statSync(exe).size };
}

// --------------------------------------------------------------- étape 12
function seal(bundle) {
  run("codesign", ["--force", "--sign", "-", "--timestamp=none", bundle]);
  run("codesign", ["--verify", "--deep", "--strict", "--verbose=2", bundle]);
  const id = parseCodesignIdentity(run("codesign", ["-dvv", bundle]).stderr);
  if (!id.adhoc) throw new Error("sceau ad hoc non constaté (codesign -dvv sans « Signature=adhoc »).");
}

// ------------------------------------------------------------------ main
async function main() {
  const t0 = Date.now();
  const durations = {};
  const step = async (key, title, fn) => {
    const s = Date.now();
    log(`— ${title}`);
    try {
      const r = await fn();
      durations[key] = Math.round((Date.now() - s) / 100) / 10;
      return r;
    } catch (e) {
      if (e instanceof StepError) throw e;
      throw new StepError(title, e?.message ?? String(e));
    }
  };

  const { opts, info } = await step("preconditions", "1. Préconditions", () => preconditions(process.argv.slice(2)));
  const cfg = loadMacConfig();
  const version = readProjectVersion();
  fs.rmSync(OUTPUT_MAC, { recursive: true, force: true });
  fs.mkdirSync(OUTPUT_MAC, { recursive: true });
  log(`JobScout ${version} pour Mac (${cfg.bundleIdentifier}), macOS ${cfg.minimumSystemVersion} minimum`);

  if (opts.nextBuild) await step("nextBuild", "2. next build", nextBuild);
  else log("— 2. next build : réutilisé (--no-next-build)");

  const { payload, app } = await step("assemble", "3. Assemblage (target mac)", () => assembleMac(version));
  const pruned = await step("prune", "4. Élagage (sharp, @img)", () => {
    const removed = prune(app);
    for (const r of removed) log(`  supprimé : ${r.path} (${mo(r.bytes)} Mo)`);
    if (!removed.length) log("  rien à élaguer");
    return removed;
  });
  const appInfo = await step("guards", "5. Gardes sur app/", () => guards(app));
  const leaksApp = await step("leaksApp", "6. Anti-fuite sur app/", () => leakCheck(app, "app/"));
  const node = await step("node", "7. Node universel", () => ensureNodeMac());
  const smoke = await step("smoke", "8. Démarrage à blanc", () => smokeTest({ payload, app, node: node.node, version }));
  const launcher = await step("launcher", "9. Lanceur", () => buildLauncher(cfg));
  const icon = await step("icon", "9. Icône", () => makeIcns());

  const bundle = bundlePathFor(cfg);
  const bundleInfo = await step("bundle", "10. Paquet JobScout.app", async () => {
    createBundle({
      cfg,
      version,
      app,
      node: node.node,
      nodeLicense: node.license,
      launcher: launcher.exe,
      icns: icon.icns,
      parentGuard: PARENT_GUARD,
      notices: NOTICES,
      out: bundle,
    });
    return checkBundle(bundle, { cfg, version, sealed: false });
  });
  const leaksBundle = await step("leaksBundle", "11. Anti-fuite sur le .app", () => leakCheck(bundle, `${cfg.bundleName}.app`));
  await step("seal", "12. Scellement ad hoc", async () => {
    seal(bundle);
    await checkBundle(bundle, { cfg, version, sealed: true });
  });

  const bundleBytes = dirBytes(bundle);
  const total = Math.round((Date.now() - t0) / 100) / 10;
  const report = {
    version,
    bundleIdentifier: cfg.bundleIdentifier,
    minimumSystemVersion: cfg.minimumSystemVersion,
    generatedAt: new Date().toISOString(),
    build: info,
    app: { files: appInfo.files, bytes: appInfo.bytes, mo: mo(appInfo.bytes), tesseractWasm: appInfo.wasm },
    pruned: pruned.map((p) => ({ path: p.path, mo: mo(p.bytes) })),
    node: {
      version: node.version,
      archs: node.archs,
      minos: node.minos,
      bytes: node.bytes,
      mo: mo(node.bytes),
      sha256: node.sha256,
      officialArchives: node.thin.map((t) => ({ key: t.key, sha256: t.sha256, mo: mo(t.bytes) })),
    },
    launcher: { archs: launcher.archs, minos: launcher.minos, bytes: launcher.bytes },
    bundle: { files: bundleInfo.files, bytes: bundleBytes, mo: mo(bundleBytes) },
    icon: { bytes: icon.bytes },
    smoke,
    leaks: { app: leaksApp, bundle: leaksBundle },
    signature: { mode: "adhoc" },
    durations,
    totalSeconds: total,
  };
  fs.writeFileSync(path.join(OUTPUT_MAC, cfg.reportName), JSON.stringify(report, null, 2) + "\n");

  const minos = (m) => [...new Set(Object.values(m))].join("/");
  notice(
    "Construction Mac",
    `JobScout ${version} : app/ ${appInfo.files} fichiers (${mo(appInfo.bytes)} Mo), node ${node.version} universel ${mo(node.bytes)} Mo ` +
      `(${node.archs}, minos ${minos(node.minos)}), lanceur ${launcher.archs} (minos ${minos(launcher.minos)}), ` +
      `JobScout.app ${mo(bundleBytes)} Mo, ${smoke.routes} routes sans 5xx, arrêt par stdin en ${smoke.stopSeconds.toFixed(1)} s, ${total} s au total`
  );
  stepSummary(
    [
      `### JobScout ${version} pour Mac — construction`,
      "",
      "| Mesure | Valeur |",
      "|---|---|",
      `| Système de construction | macOS ${info.macos} ${info.arch}, ${info.xcode} |`,
      `| app/ | ${appInfo.files} fichiers, ${mo(appInfo.bytes)} Mo |`,
      `| Élagué | ${pruned.map((p) => `${p.path} (${mo(p.bytes)} Mo)`).join(", ") || "rien"} |`,
      `| Node | ${node.version}, ${node.archs}, ${mo(node.bytes)} Mo, minos ${minos(node.minos)} |`,
      `| Lanceur | ${launcher.archs}, minos ${minos(launcher.minos)} |`,
      `| JobScout.app | ${bundleInfo.files} fichiers, ${mo(bundleBytes)} Mo |`,
      `| Démarrage à blanc | prêt en ${smoke.readySeconds.toFixed(1)} s, ${smoke.routes} routes sans 5xx, arrêt en ${smoke.stopSeconds.toFixed(1)} s |`,
      `| Anti-fuite | app/ ${leaksApp.scanned} fichiers, .app ${leaksBundle.scanned} fichiers, 0 occurrence |`,
      `| Durée | ${total} s (${Object.entries(durations).map(([k, v]) => `${k} ${v} s`).join(", ")}) |`,
      "",
    ].join("\n")
  );
}

if (isMainModule(import.meta.url)) {
  runMain("Construction Mac", main);
}
