// ============================================================================
// installer/mac/make-dmg.mjs — image disque JobScout-Mac.dmg et SHA256SUMS.txt.
//
//   node installer/mac/make-dmg.mjs        (macOS, après build-mac.mjs et
//                                           sign-mac.mjs app)
//
//   1. préparation : ditto de JobScout.app, lien Applications -> /Applications,
//      LISEZ-MOI.txt (installer/mac/LISEZ-MOI.txt, version substituée, UTF-8
//      avec BOM pour que TextEdit et Coup d'œil lisent les accents) ;
//   2. hdiutil create -volname "JobScout <version>" -srcfolder … -fs HFS+
//      -format UDZO -imagekey zlib-level=9 -ov, 3 essais espacés, detach
//      -force des volumes restés montés avant le dernier ;
//   3. hdiutil verify, puis montage en lecture seule : contenu EXACT constaté ;
//   4. en mode Developer ID (5 secrets) : signature, notarisation et agrafage
//      du DMG (sign-mac.mjs) ; configuration partielle → erreur ;
//   5. shasum -a 256 → SHA256SUMS.txt, égal au calcul en JS, relu par
//      shasum -c ; rapport-construction.json complété (taille, empreinte).
// ============================================================================
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import {
  HERE,
  OUTPUT_MAC,
  PROJECT,
  bundlePathFor,
  fail,
  hasTool,
  isMainModule,
  loadMacConfig,
  mo,
  notice,
  readPlist,
  readProjectVersion,
  requireDarwin,
  run,
  runMain,
  stepSummary,
  warning,
} from "./bundle.mjs";
import { detectSigningMode, macSigningMode, signDmg } from "./sign-mac.mjs";

export const README_TEMPLATE = path.join(HERE, "LISEZ-MOI.txt");
const TITLE = "Image disque";
const log = (m) => process.stdout.write(`[make-dmg] ${m}\n`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** LISEZ-MOI du DMG : {{version}} substitué, fins de ligne \n, BOM UTF-8. */
export function renderReadme(template, { version }) {
  const text = String(template).replace(/^﻿/, "").replace(/\r\n/g, "\n").replace(/\{\{version\}\}/g, version);
  const left = /\{\{[^}]*\}\}/.exec(text);
  if (left) throw new Error(`LISEZ-MOI.txt : variable non substituée ${left[0]}`);
  return "﻿" + text;
}

/** Ligne attendue de SHA256SUMS.txt (format de `shasum -a 256`). */
export const sumsLine = (sha256, name) => `${sha256}  ${name}\n`;

/** Ligne de `shasum -a 256 <nom>` → empreinte, ou null si la forme n'est pas exacte. */
export function parseShasumLine(text, name) {
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = new RegExp(`^([0-9a-f]{64}) [ *]${esc}$`).exec(String(text).trim());
  return m ? m[1] : null;
}

function sha256File(file) {
  const h = crypto.createHash("sha256");
  const fd = fs.openSync(file, "r");
  try {
    const buf = Buffer.alloc(8 * 1024 * 1024);
    let n;
    while ((n = fs.readSync(fd, buf, 0, buf.length, null)) > 0) h.update(buf.subarray(0, n));
  } finally {
    fs.closeSync(fd);
  }
  return h.digest("hex");
}

/** Détache de force les volumes « <volname> » restés montés (essais précédents). */
function detachStale(volname) {
  if (!fs.existsSync("/Volumes")) return;
  for (const v of fs.readdirSync("/Volumes")) {
    if (v === volname || v.startsWith(`${volname} `)) {
      const r = run("hdiutil", ["detach", "-force", path.join("/Volumes", v)], { allowFail: true });
      log(`  detach -force /Volumes/${v} : code ${r.status}`);
    }
  }
}

async function createImage({ prep, dmg, volname }) {
  let last = "";
  for (let attempt = 1; attempt <= 3; attempt++) {
    if (attempt === 3) detachStale(volname);
    fs.rmSync(dmg, { force: true });
    const r = run(
      "hdiutil",
      ["create", "-volname", volname, "-srcfolder", prep, "-fs", "HFS+", "-format", "UDZO", "-imagekey", "zlib-level=9", "-ov", dmg],
      { allowFail: true, timeout: 20 * 60 * 1000 }
    );
    if (r.status === 0 && fs.existsSync(dmg)) return attempt;
    last = (r.stderr || r.stdout).trim().split("\n").slice(-5).join(" | ");
    warning(TITLE, `hdiutil create, essai ${attempt}/3 en échec (code ${r.status}) : ${last}`);
    if (attempt < 3) await sleep(attempt * 10_000);
  }
  throw new Error(`hdiutil create : 3 essais en échec. Dernière erreur : ${last}`);
}

async function detach(mountpoint) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const r = run("hdiutil", ["detach", ...(attempt === 3 ? ["-force"] : []), mountpoint], { allowFail: true });
    if (r.status === 0) return;
    await sleep(3000 * attempt);
  }
  throw new Error(`hdiutil detach ${mountpoint} : impossible de démonter le volume.`);
}

/** Monte le DMG en lecture seule et constate son contenu exact. */
async function inspectImage({ dmg, cfg, version }) {
  const mountpoint = fs.mkdtempSync(path.join(os.tmpdir(), "jobscout-dmg-"));
  run("hdiutil", ["attach", "-readonly", "-nobrowse", "-noautoopen", "-mountpoint", mountpoint, dmg]);
  try {
    const entries = fs.readdirSync(mountpoint).sort();
    const visible = entries.filter((e) => !e.startsWith("."));
    const expected = ["Applications", `${cfg.bundleName}.app`, "LISEZ-MOI.txt"].sort();
    const problems = [];
    if (visible.join("|") !== expected.join("|")) {
      problems.push(`contenu visible [${visible.join(", ")}], attendu exactement [${expected.join(", ")}]`);
    }
    const link = path.join(mountpoint, "Applications");
    if (!fs.lstatSync(link, { throwIfNoEntry: false })?.isSymbolicLink() || fs.readlinkSync(link) !== "/Applications") {
      problems.push("Applications n'est pas un lien vers /Applications");
    }
    const readme = fs.readFileSync(path.join(mountpoint, "LISEZ-MOI.txt"), "utf-8");
    if (!readme.startsWith(`﻿${cfg.bundleName} ${version} pour Mac\n`)) {
      problems.push("LISEZ-MOI.txt : première ligne différente de « JobScout <version> pour Mac »");
    }
    const plist = path.join(mountpoint, `${cfg.bundleName}.app`, "Contents", "Info.plist");
    const v = fs.existsSync(plist) ? readPlist(plist).CFBundleShortVersionString : null;
    if (v !== version) problems.push(`Info.plist du volume : version « ${v} », attendu « ${version} »`);
    const hidden = entries.filter((e) => e.startsWith("."));
    if (hidden.length) log(`  entrées cachées du volume (information) : ${hidden.join(", ")}`);
    if (problems.length) throw new Error(`contenu du DMG non conforme :\n  - ${problems.join("\n  - ")}`);
  } finally {
    await detach(mountpoint);
    fs.rmSync(mountpoint, { recursive: true, force: true });
  }
}

export async function makeDmg() {
  requireDarwin(TITLE);
  for (const t of ["hdiutil", "ditto", "shasum", "codesign", "plutil"]) {
    if (!hasTool(t)) fail(TITLE, `outil absent : ${t}`);
  }
  const cfg = loadMacConfig();
  const version = readProjectVersion();
  const mode = macSigningMode(process.env); // configuration partielle → exception
  const app = bundlePathFor(cfg);
  if (!fs.existsSync(app)) fail(TITLE, `${path.basename(app)} absent : lancez d'abord build-mac.mjs.`);

  const plistVersion = readPlist(path.join(app, "Contents", "Info.plist")).CFBundleShortVersionString;
  if (plistVersion !== version) fail(TITLE, `Info.plist (${plistVersion}) ≠ version.json (${version}).`);
  run("codesign", ["--verify", "--deep", "--strict", "--verbose=2", app]);
  const appMode = detectSigningMode(app);
  if (mode === "developer-id") {
    if (appMode !== "developer-id") fail(TITLE, "mode Developer ID mais l'app n'est pas signée Developer ID : l'étape « sign-mac.mjs app » n'a pas tourné.");
    const v = run("xcrun", ["stapler", "validate", app], { allowFail: true });
    if (v.status !== 0 || !/^The validate action worked!$/m.test(v.stdout)) fail(TITLE, "mode Developer ID mais le ticket de notarisation n'est pas agrafé à l'app.");
  } else if (appMode !== "adhoc") {
    fail(TITLE, `mode ad hoc mais la signature de l'app est « ${appMode} ».`);
  }

  const report = path.join(OUTPUT_MAC, cfg.reportName);
  if (!fs.existsSync(report)) fail(TITLE, `${cfg.reportName} absent : lancez d'abord build-mac.mjs.`);

  const volname = `${cfg.bundleName} ${version}`;
  const dmg = path.join(OUTPUT_MAC, cfg.dmgName);
  const sums = path.join(OUTPUT_MAC, cfg.sumsName);
  for (const f of [dmg, sums]) fs.rmSync(f, { force: true });

  const t0 = Date.now();
  const prep = path.join(OUTPUT_MAC, "dmg-source");
  fs.rmSync(prep, { recursive: true, force: true });
  fs.mkdirSync(prep, { recursive: true });
  try {
    log(`préparation du volume « ${volname} »`);
    run("ditto", ["--norsrc", "--noextattr", "--noqtn", "--noacl", app, path.join(prep, `${cfg.bundleName}.app`)]);
    run("codesign", ["--verify", "--deep", "--strict", path.join(prep, `${cfg.bundleName}.app`)]);
    fs.symlinkSync("/Applications", path.join(prep, "Applications"));
    fs.writeFileSync(path.join(prep, "LISEZ-MOI.txt"), renderReadme(fs.readFileSync(README_TEMPLATE, "utf-8"), { version }), "utf-8");

    log("hdiutil create (UDZO, zlib-level=9)…");
    const attempts = await createImage({ prep, dmg, volname });
    log(`  image créée (essai ${attempts}/3)`);
  } finally {
    fs.rmSync(prep, { recursive: true, force: true });
  }

  run("hdiutil", ["verify", dmg]);
  log("hdiutil verify : OK");
  await inspectImage({ dmg, cfg, version });
  log("contenu du volume constaté : JobScout.app, Applications -> /Applications, LISEZ-MOI.txt");

  let signing = { mode };
  if (mode === "developer-id") {
    log("signature, notarisation et agrafage du DMG…");
    signing = { mode, ...signDmg(dmg, process.env) };
    run("hdiutil", ["verify", dmg]);
  }

  const shasum = run("shasum", ["-a", "256", cfg.dmgName], { cwd: OUTPUT_MAC }).stdout;
  const fromShasum = parseShasumLine(shasum, cfg.dmgName);
  const fromJs = sha256File(dmg);
  if (!fromShasum) fail(TITLE, `sortie de shasum inattendue : ${shasum.trim()}`);
  if (fromShasum !== fromJs) fail(TITLE, `SHA-256 divergents : shasum ${fromShasum}, calcul JS ${fromJs}.`);
  fs.writeFileSync(sums, sumsLine(fromJs, cfg.dmgName), "utf-8");
  const check = run("shasum", ["-a", "256", "-c", cfg.sumsName], { cwd: OUTPUT_MAC, allowFail: true });
  const okLine = new RegExp(`^${cfg.dmgName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}: OK$`, "m");
  if (check.status !== 0 || !okLine.test(check.stdout)) fail(TITLE, `shasum -c ${cfg.sumsName} : ${(check.stdout + check.stderr).trim()}`);

  const bytes = fs.statSync(dmg).size;
  const r = JSON.parse(fs.readFileSync(report, "utf-8"));
  r.dmg = { name: cfg.dmgName, volume: volname, bytes, mo: mo(bytes), sha256: fromJs, signing: signing.mode, seconds: Math.round((Date.now() - t0) / 100) / 10 };
  fs.writeFileSync(report, JSON.stringify(r, null, 2) + "\n");

  const rel = path.relative(PROJECT, dmg).split(path.sep).join("/");
  notice(TITLE, `${cfg.dmgName} : ${mo(bytes)} Mo, volume « ${volname} », signature ${signing.mode}, SHA-256 ${fromJs} (${rel})`);
  stepSummary(
    `### ${cfg.dmgName}\n\n| | |\n|---|---|\n| Volume | ${volname} |\n| Taille | ${mo(bytes)} Mo |\n| Signature | ${signing.mode} |\n| SHA-256 | \`${fromJs}\` |\n`
  );
  return { dmg, sums, bytes, sha256: fromJs, mode: signing.mode };
}

if (isMainModule(import.meta.url)) {
  runMain(TITLE, makeDmg);
}
